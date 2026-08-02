UPDATE products
SET body_html = '',
    ai_status = 'pending',
    ai_error = 'Invalid AI reasoning output removed; enrichment queued for regeneration',
    updated_at = now()
WHERE body_html ~* '(we are writing|steps:[[:space:]]*[0-9]|let me re-read|the instruction says|reasoning|we must write)'
  AND body_html !~* '^[[:space:]]*<p[ >]';
