import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export function PdfPreview({ source }: { source: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  const [rendered, setRendered] = useState(false);
  useEffect(() => {
    let active = true;
    let loading: ReturnType<typeof pdfjs.getDocument> | undefined;
    let rendering: { cancel(): void; promise: Promise<void> } | undefined;
    const render = async () => {
      try {
        setRendered(false);
        const response = await fetch(source, { credentials: "same-origin" });
        if (!response.ok) throw new Error("PDF artifact is unavailable.");
        loading = pdfjs.getDocument({ data: new Uint8Array(await response.arrayBuffer()) });
        const document = await loading.promise;
        const page = await document.getPage(1);
        const viewport = page.getViewport({ scale: 1.35 });
        const target = canvas.current;
        if (!active || !target) return;
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        const context = target.getContext("2d", { alpha: false });
        if (!context) throw new Error("PDF canvas is unavailable.");
        rendering = page.render({ canvas: target, canvasContext: context, viewport });
        await rendering.promise;
        if (active) {
          setError("");
          setRendered(true);
        }
      } catch (cause) {
        if (active && !(cause instanceof Error && cause.name === "RenderingCancelledException"))
          setError(cause instanceof Error ? cause.message : "PDF preview failed.");
      }
    };
    void render();
    return () => {
      active = false;
      rendering?.cancel();
      void loading?.destroy();
    };
  }, [source]);
  return (
    <div className="pdf-preview">
      {error && (
        <span className="pdf-preview-error" role="alert">
          {error}
        </span>
      )}
      <canvas
        ref={canvas}
        data-rendered={rendered ? "true" : "false"}
        aria-label="Rendered first page of the tailored CV PDF"
      />
    </div>
  );
}
