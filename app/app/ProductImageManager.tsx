"use client";
/* eslint-disable @next/next/no-img-element -- workspace product images use dynamic source hosts */

import { useMemo, useState } from "react";
import { Check, Crop, GripVertical, Image as ImageIcon, Link2, ScanLine, Sparkles, Trash2 } from "lucide-react";
import { productImages, type ProductImage } from "@/app/lib/product-images";

type Variant = { source_variant_id: string; option_value: string; sku: string };
type GalleryProduct = {
  id: string;
  title: string;
  image_url: string;
  images?: ProductImage[];
  variants: Variant[];
};

type Props = {
  product: GalleryProduct;
  onChange: (images: ProductImage[]) => void;
  notify: (message: string) => void;
};

const newImageId = () => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

export function ProductImageManager({ product, onChange, notify }: Props) {
  const images = useMemo(() => productImages(product as unknown as Record<string, unknown>), [product]);
  const [activeId, setActiveId] = useState("");
  const [dragId, setDragId] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const active = images.find((image) => image.id === activeId) || images[0];
  const warnings = images.filter((image) => image.quality_status === "warning" || image.duplicate_of).length;

  const commit = (next: ProductImage[]) => onChange(next.map((image, index) => ({ ...image, position: index + 1 })));
  const patchImage = (id: string, patch: Partial<ProductImage>) => commit(images.map((image) => image.id === id ? { ...image, ...patch } : image));

  const addImage = () => {
    const value = url.trim();
    if (!/^https:\/\//i.test(value)) return notify("Paste a valid HTTPS image URL");
    if (images.some((image) => image.url.toLowerCase() === value.toLowerCase())) return notify("That image is already in this gallery");
    const next = [...images, { id: newImageId(), url: value, source_url: value, position: images.length + 1, alt: product.title, variant_ids: [], processing_status: "original" as const }];
    commit(next);
    setUrl("");
    setActiveId(next[next.length - 1].id);
  };

  const move = (sourceId: string, targetId: string) => {
    if (!sourceId || sourceId === targetId) return;
    const next = [...images];
    const sourceIndex = next.findIndex((image) => image.id === sourceId);
    const targetIndex = next.findIndex((image) => image.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [item] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, item);
    commit(next);
  };

  const persistGallery = async (gallery: ProductImage[]) => {
    const response = await fetch(`/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images: gallery }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not save gallery");
  };

  const processOne = async (image: ProductImage, action: "analyze" | "normalize" | "remove_background", persist = true) => {
    if (persist) await persistGallery(images);
    const response = await fetch(`/api/products/${product.id}/images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_id: image.id, action }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Image processing failed");
    return payload as ProductImage;
  };

  const runOne = async (image: ProductImage, action: "normalize" | "remove_background") => {
    setBusy(`${action}:${image.id}`);
    try {
      const result = await processOne(image, action);
      patchImage(image.id, result);
      notify(action === "normalize" ? "Image fitted to a 1600 × 1600 canvas" : "Background removed and image centered");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Image processing failed");
    } finally {
      setBusy("");
    }
  };

  const analyzeAll = async () => {
    if (!images.length) return;
    setBusy("analyze");
    setProgress({ completed: 0, total: images.length });
    try {
      await persistGallery(images);
      let working = [...images];
      for (let index = 0; index < images.length; index += 1) {
        const result = await processOne(images[index], "analyze", false);
        working = working.map((image) => image.id === result.id ? { ...image, ...result } : image);
        commit(working);
        setProgress({ completed: index + 1, total: images.length });
      }
      notify("Gallery quality check complete");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Gallery check failed");
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="image-manager">
      <header className="image-manager-head">
        <div><span className="kicker">PRODUCT MEDIA</span><h3>Image gallery</h3><p>Drag to reorder. The first image becomes the Shopify cover.</p></div>
        <div className="image-summary"><strong>{images.length}</strong><span>images</span>{warnings > 0 && <em>{warnings} need attention</em>}</div>
      </header>

      {active ? (
        <div className="image-stage">
          <img src={active.url} alt={active.alt || product.title} referrerPolicy="no-referrer" />
          <span className="image-position">#{active.position} {active.position === 1 ? "Cover" : "Gallery"}</span>
          {active.processing_status && active.processing_status !== "original" && <span className="image-processed"><Check size={11} /> {active.processing_status.replace("_", " ")}</span>}
        </div>
      ) : <div className="image-empty"><ImageIcon size={24} /><strong>No product images</strong><span>Add a secure image URL below.</span></div>}

      <div className="image-strip" aria-label="Reorder product images">
        {images.map((image) => (
          <button
            type="button"
            draggable
            className={`image-tile ${active?.id === image.id ? "active" : ""} ${image.quality_status === "warning" || image.duplicate_of ? "warning" : ""}`}
            key={image.id}
            onClick={() => setActiveId(image.id)}
            onDragStart={() => setDragId(image.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => { move(dragId, image.id); setDragId(""); }}
          >
            <img src={image.url} alt="" referrerPolicy="no-referrer" />
            <span><GripVertical size={12} />{image.position}</span>
          </button>
        ))}
      </div>

      {active && (
        <div className="image-inspector">
          <div className="image-inspector-top">
            <strong>Image {active.position}</strong>
            <span>{active.width && active.height ? `${active.width} × ${active.height}` : "Not analyzed"}</span>
            {active.aspect_ratio && <span>{active.aspect_ratio}:1</span>}
            {active.duplicate_of && <em>Duplicate detected</em>}
          </div>
          {active.quality_warnings?.length ? <ul>{active.quality_warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : active.quality_status === "ready" ? <p className="image-ready"><Check size={12} /> Resolution and ratio are ready</p> : null}
          <label>Alt text<input value={active.alt || ""} onChange={(event) => patchImage(active.id, { alt: event.target.value })} /></label>
          <label>Variant image<select value={active.variant_ids?.[0] || ""} onChange={(event) => patchImage(active.id, { variant_ids: event.target.value ? [event.target.value] : [] })}><option value="">All variants</option>{product.variants.map((variant) => { const key = variant.source_variant_id || variant.option_value; return <option value={key} key={key}>{variant.option_value}{variant.sku ? ` · ${variant.sku}` : ""}</option>; })}</select></label>
          <div className="image-actions">
            {active.position !== 1 && <button type="button" onClick={() => move(active.id, images[0].id)}><ImageIcon size={13} /> Make cover</button>}
            <button type="button" disabled={Boolean(busy)} onClick={() => void runOne(active, "normalize")}><Crop size={13} /> {busy === `normalize:${active.id}` ? "Normalizing…" : "Fit 1:1 canvas"}</button>
            <button type="button" disabled={Boolean(busy)} onClick={() => void runOne(active, "remove_background")}><Sparkles size={13} /> {busy === `remove_background:${active.id}` ? "Cleaning…" : "Remove background"}</button>
            <button type="button" className="image-delete" onClick={() => { const next = images.filter((image) => image.id !== active.id); commit(next); setActiveId(next[0]?.id || ""); }}><Trash2 size={13} /> Remove</button>
          </div>
        </div>
      )}

      <div className="image-add-row"><Link2 size={14} /><input aria-label="New image URL" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://cdn.example.com/product-image.jpg" /><button type="button" onClick={addImage}>Add image</button></div>
      <button type="button" className="image-quality-button" disabled={!images.length || Boolean(busy)} onClick={() => void analyzeAll()}><ScanLine size={14} />{busy === "analyze" ? `Checking ${progress.completed} of ${progress.total}…` : "Check duplicates & image quality"}</button>
      {busy === "analyze" && <span className="image-progress"><i style={{ width: `${progress.total ? progress.completed / progress.total * 100 : 0}%` }} /></span>}
    </section>
  );
}
