import hashlib
import io
import ipaddress
import socket
from pathlib import Path
from urllib.parse import urljoin, urlparse
from uuid import UUID

import httpx
from PIL import Image, ImageOps

from .config import get_settings
from .db import connection

MAX_IMAGE_BYTES = 20 * 1024 * 1024
CANVAS_SIZE = 1600
MEDIA_ROOT = Path('/app/media')


def _validate_public_image_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != 'https' or not parsed.hostname:
        raise ValueError('A public HTTPS image URL is required')
    for result in socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM):
        address = ipaddress.ip_address(result[4][0])
        if address.is_private or address.is_loopback or address.is_link_local or address.is_reserved:
            raise ValueError('Private network image URLs are not allowed')


def _download(url: str) -> tuple[bytes, str]:
    current = url
    with httpx.Client(timeout=30, follow_redirects=False, headers={'User-Agent': 'ScrappifyImageWorker/1.0'}) as client:
        for _ in range(4):
            _validate_public_image_url(current)
            response = client.get(current)
            if response.status_code in {301, 302, 303, 307, 308}:
                target = response.headers.get('location')
                if not target:
                    raise ValueError('Image redirect has no destination')
                current = urljoin(current, target)
                continue
            response.raise_for_status()
            content_type = response.headers.get('content-type', '').split(';')[0].lower()
            if not content_type.startswith('image/'):
                raise ValueError('URL did not return an image')
            data = response.content
            if len(data) > MAX_IMAGE_BYTES:
                raise ValueError('Image is larger than 20 MB')
            return data, content_type
    raise ValueError('Too many image redirects')


def _inspect(data: bytes) -> tuple[Image.Image, dict]:
    digest = hashlib.sha256(data).hexdigest()
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except (OSError, ValueError) as exc:
        raise ValueError('Image file could not be decoded') from exc
    width, height = image.size
    if width <= 0 or height <= 0:
        raise ValueError('Image dimensions are invalid')
    ratio = round(width / height, 4)
    warnings = []
    if width < 800 or height < 800:
        warnings.append('Resolution is below 800 × 800')
    if ratio < 0.8 or ratio > 1.25:
        warnings.append('Aspect ratio is not commerce-ready')
    return image, {
        'width': width,
        'height': height,
        'aspect_ratio': ratio,
        'bytes': len(data),
        'sha256': digest,
        'quality_status': 'warning' if warnings else 'ready',
        'quality_warnings': warnings,
    }


def _square_canvas(image: Image.Image, transparent: bool) -> Image.Image:
    fitted = ImageOps.contain(image.convert('RGBA'), (CANVAS_SIZE - 160, CANVAS_SIZE - 160), Image.Resampling.LANCZOS)
    background = (255, 255, 255, 0 if transparent else 255)
    canvas = Image.new('RGBA', (CANVAS_SIZE, CANVAS_SIZE), background)
    canvas.alpha_composite(fitted, ((CANVAS_SIZE - fitted.width) // 2, (CANVAS_SIZE - fitted.height) // 2))
    return canvas


def _public_media_url(filename: str, request_base_url: str) -> str:
    configured = get_settings().public_api_url.strip().rstrip('/')
    base = configured or request_base_url.rstrip('/')
    return f'{base}/media/{filename}'


def process_product_image(product_id: UUID, workspace_id: UUID, image_id: str, action: str, request_base_url: str) -> dict:
    if action not in {'analyze', 'normalize', 'remove_background'}:
        raise ValueError('Unsupported image action')
    with connection() as conn:
        product = conn.execute(
            'SELECT id,title,image_url,images FROM products WHERE id=%s AND workspace_id=%s',
            (product_id, workspace_id),
        ).fetchone()
        if not product:
            raise ValueError('Product not found')
        images = list(product.get('images') or [])
        if not images and product.get('image_url'):
            images = [{
                'id': hashlib.md5(product['image_url'].encode()).hexdigest(),
                'url': product['image_url'], 'source_url': product['image_url'],
                'position': 1, 'alt': product['title'], 'variant_ids': [],
                'processing_status': 'original',
            }]
        index = next((i for i, item in enumerate(images) if str(item.get('id')) == image_id), -1)
        if index < 0:
            raise ValueError('Image not found')
        item = dict(images[index])
        data, _ = _download(str(item.get('url') or item.get('source_url') or ''))
        pil_image, metadata = _inspect(data)

        if action in {'normalize', 'remove_background'}:
            transparent = action == 'remove_background'
            if action == 'remove_background':
                try:
                    from rembg import remove
                except ImportError as exc:
                    raise ValueError('Background cleanup is not installed on the image worker') from exc
                removed = remove(data)
                pil_image, _ = _inspect(removed)
            output = _square_canvas(pil_image, transparent)
            extension = 'png' if transparent else 'webp'
            filename = f'{workspace_id}-{product_id}-{image_id[:16]}-{action}.{extension}'
            MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
            destination = MEDIA_ROOT / filename
            if transparent:
                output.save(destination, 'PNG', optimize=True)
            else:
                output.convert('RGB').save(destination, 'WEBP', quality=92, method=6)
            processed = destination.read_bytes()
            _, metadata = _inspect(processed)
            item['url'] = _public_media_url(filename, request_base_url)
            item['processing_status'] = 'background_removed' if transparent else 'normalized'

        item.update(metadata)
        item['duplicate_of'] = next((
            str(other.get('id')) for other in images
            if str(other.get('id')) != image_id and other.get('sha256') == metadata['sha256']
        ), None)
        images[index] = item
        images = [dict(image, position=position + 1) for position, image in enumerate(images)]
        conn.execute(
            'UPDATE products SET images=%s::jsonb,image_url=%s,updated_at=now() WHERE id=%s AND workspace_id=%s',
            (__import__('json').dumps(images, ensure_ascii=False), images[0].get('url', '') if images else '', product_id, workspace_id),
        )
        conn.commit()
    return item
