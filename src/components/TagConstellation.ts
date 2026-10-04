export interface ConstellationTag {
  tag: string;
  count?: number;
}

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  tag: string;
  top: boolean;
}

function cssVar(el: HTMLElement, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Tag constellation: an Obsidian-graph-inspired canvas where trending tags
 * drift as nodes sized by post count. Custom implementation, no library.
 * Static when prefers-reduced-motion is set; pauses while offscreen.
 */
export function createTagConstellation(
  tags: ConstellationTag[],
  onSelect: (tag: string) => void,
): { element: HTMLElement; destroy: () => void } {
  const wrap = document.createElement('div');
  wrap.className = 'constellation-wrap';

  const canvas = document.createElement('canvas');
  canvas.className = 'constellation-canvas';
  canvas.setAttribute('role', 'img');
  wrap.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx || tags.length === 0) {
    return { element: wrap, destroy: () => {} };
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const maxCount = Math.max(1, ...tags.map((tg) => tg.count ?? 0));
  const nodes: Node[] = tags.slice(0, 10).map((tg, i) => {
    const angle = (i / Math.max(1, Math.min(tags.length, 10))) * Math.PI * 2;
    return {
      x: 0.5 + Math.cos(angle) * (0.18 + ((i * 37) % 20) / 100),
      y: 0.5 + Math.sin(angle) * (0.22 + ((i * 53) % 18) / 100),
      vx: (((i * 7919) % 100) / 100 - 0.5) * 0.0006,
      vy: (((i * 4799) % 100) / 100 - 0.5) * 0.0006,
      r: 7 + 20 * Math.sqrt((tg.count ?? 0) / maxCount),
      tag: tg.tag,
      top: i === 0,
    };
  });

  let raf = 0;
  let running = false;
  let w = 0;
  let h = 0;
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  const resize = (): void => {
    const rect = canvas.getBoundingClientRect();
    w = Math.max(1, rect.width);
    h = Math.max(1, rect.height);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  };

  const draw = (): void => {
    const style = getComputedStyle(canvas);
    const accent = cssVar(canvas, '--accent', '#22c55e').trim();
    const ink = style.color || '#94a3b8';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Edges: each node links to its two nearest neighbours.
    ctx.lineWidth = 1;
    for (const [i, a] of nodes.entries()) {
      const others = nodes
        .map((b, j) => ({ b, j, d: (a.x - b.x) ** 2 + (a.y - b.y) ** 2 }))
        .filter((o) => o.j !== i)
        .sort((p, q) => p.d - q.d)
        .slice(0, 2);
      for (const { b } of others) {
        ctx.strokeStyle = accent + '2e';
        ctx.beginPath();
        ctx.moveTo(a.x * w, a.y * h);
        ctx.lineTo(b.x * w, b.y * h);
        ctx.stroke();
      }
    }

    for (const n of nodes) {
      const cx = n.x * w;
      const cy = n.y * h;
      if (n.top) {
        ctx.shadowColor = accent;
        ctx.shadowBlur = 18;
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(cx, cy, n.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        ctx.fillStyle = accent + '33';
        ctx.beginPath();
        ctx.arc(cx, cy, n.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.fillStyle = ink;
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      const label = `#${n.tag}`;
      const labelWidth = ctx.measureText(label).width;
      const lx = Math.min(Math.max(cx, labelWidth / 2 + 4), w - labelWidth / 2 - 4);
      ctx.fillText(label, lx, cy + n.r + 14);
    }
  };

  const step = (): void => {
    if (!running) return;
    for (const n of nodes) {
      n.x += n.vx;
      n.y += n.vy;
      const rx = n.r / w;
      const ry = (n.r + 16) / h;
      if (n.x < rx || n.x > 1 - rx) n.vx *= -1;
      if (n.y < ry || n.y > 1 - ry) n.vy *= -1;
      n.x = Math.min(Math.max(n.x, rx), 1 - rx);
      n.y = Math.min(Math.max(n.y, ry), 1 - ry);
    }
    draw();
    raf = requestAnimationFrame(step);
  };

  const start = (): void => {
    if (running || reduced) {
      draw();
      return;
    }
    running = true;
    raf = requestAnimationFrame(step);
  };

  const stop = (): void => {
    running = false;
    cancelAnimationFrame(raf);
  };

  const onClick = (e: MouseEvent): void => {
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    let best: Node | null = null;
    let bestD = Infinity;
    for (const n of nodes) {
      const d = (n.x - px) ** 2 * w * w + (n.y - py) ** 2 * h * h;
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    if (best && bestD < (best.r + 22) ** 2) {
      onSelect(best.tag);
    }
  };
  canvas.addEventListener('click', onClick);

  const resizeObserver = new ResizeObserver(() => {
    resize();
    if (!running) draw();
  });
  resizeObserver.observe(canvas);

  const visibility = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting) start();
      else stop();
    },
    { threshold: 0.05 },
  );
  visibility.observe(canvas);

  resize();
  start();

  return {
    element: wrap,
    destroy: () => {
      stop();
      resizeObserver.disconnect();
      visibility.disconnect();
      canvas.removeEventListener('click', onClick);
    },
  };
}
