import { useEffect, useRef, useState } from "react";
import { refineWhiteBackgroundMask } from "./white-background-refine.js";

const MAX_FILE_SIZE = 30 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const SIZE_PRESETS = [
  { id: "fast", title: "Fast", detail: "1,280 px", maxSide: 1280 },
  { id: "full", title: "Full", detail: "2,048 px", maxSide: 2048 },
];

const BACKGROUNDS = [
  { id: "transparent", label: "Transparent", color: null },
  { id: "paper", label: "Paper white", color: "#ffffff" },
  { id: "peach", label: "Soft peach", color: "#f9e6d7" },
  { id: "lilac", label: "Lilac", color: "#e8e3ff" },
  { id: "ink", label: "Warm cocoa", color: "#3a2a20" },
];

const iconShapes = {
  sparkle: (
    <>
      <path d="m12 3 1.55 5.45L19 10l-5.45 1.55L12 17l-1.55-5.45L5 10l5.45-1.55L12 3Z" />
      <path d="m19 16 .72 2.28L22 19l-2.28.72L19 22l-.72-2.28L16 19l2.28-.72L19 16Z" />
      <path d="m5 2 .55 1.45L7 4l-1.45.55L5 6l-.55-1.45L3 4l1.45-.55L5 2Z" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 16.5v2A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-2" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </>
  ),
  shield: (
    <>
      <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5" />
      <path d="M4.9 9A8 8 0 0 1 18.2 6L20 7" />
      <path d="M4 17v-5h5" />
      <path d="M19.1 15A8 8 0 0 1 5.8 18L4 17" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  lock: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 1 1 8 0v3" />
    </>
  ),
  close: <path d="m18 6-12 12M6 6l12 12" />,
  compare: (
    <>
      <path d="M12 3v18" />
      <path d="M3 5h18v14H3z" />
    </>
  ),
  eraser: (
    <>
      <path d="m7 20 11.5-11.5a3 3 0 0 0-4.2-4.2L3.2 15.4a3 3 0 0 0 4.2 4.2Z" />
      <path d="m9 20 5-5" />
      <path d="M5.5 13.2 11 18.7" />
    </>
  ),
};

function Icon({ name, size = 18, className = "" }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconShapes[name]}
    </svg>
  );
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDimensions(dimensions) {
  if (!dimensions?.width || !dimensions?.height) return "";
  return `${dimensions.width.toLocaleString()} × ${dimensions.height.toLocaleString()} px`;
}

function getProgressLabel(key) {
  const text = String(key ?? "").toLowerCase();
  if (text.includes("fetch") || text.includes("download") || text.includes("model")) {
    return "Loading the on-device AI model";
  }
  if (text.includes("wasm") || text.includes("runtime")) {
    return "Starting the image engine";
  }
  return "Finding the subject and cleaning the edges";
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The browser could not prepare this image."));
    }, "image/png");
  });
}

async function refineAndEncodeRgbaBlob(rgbaBlob) {
  const width = Number(/(?:^|;)width=(\d+)(?:;|$)/i.exec(rgbaBlob.type)?.[1]);
  const height = Number(/(?:^|;)height=(\d+)(?:;|$)/i.exec(rgbaBlob.type)?.[1]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error("The local AI returned image data without valid dimensions.");
  }

  const rgba = new Uint8ClampedArray(await rgbaBlob.arrayBuffer());
  if (rgba.length !== width * height * 4) {
    throw new Error("The local AI returned an incomplete RGBA image.");
  }
  refineWhiteBackgroundMask(rgba, width, height);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not finish refining the cutout.");
  context.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvasToBlob(canvas);
}

async function resizeForModel(file, maxSide) {
  let bitmap;
  let closeBitmap = () => {};

  if (typeof createImageBitmap === "function") {
    bitmap = await createImageBitmap(file);
    closeBitmap = () => bitmap.close?.();
  } else {
    const localUrl = URL.createObjectURL(file);
    bitmap = new Image();
    bitmap.src = localUrl;
    try {
      await bitmap.decode();
    } catch (error) {
      URL.revokeObjectURL(localUrl);
      throw error;
    }
    closeBitmap = () => URL.revokeObjectURL(localUrl);
  }

  try {
    const longestSide = Math.max(bitmap.width, bitmap.height);
    if (longestSide <= maxSide) return file;

    const scale = maxSide / longestSide;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not prepare the image.");

    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await canvasToBlob(canvas);
  } finally {
    closeBitmap();
  }
}

function limitThreadsForCurrentContext() {
  if (globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== "undefined") return () => {};

  const hadOwnValue = Object.prototype.hasOwnProperty.call(navigator, "hardwareConcurrency");
  const previousDescriptor = Object.getOwnPropertyDescriptor(navigator, "hardwareConcurrency");
  try {
    // The library otherwise chooses all reported cores. One thread keeps WASM usable
    // in sandboxed previews and browsers that cannot enable SharedArrayBuffer.
    Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, value: 1 });
  } catch {
    return () => {};
  }

  return () => {
    try {
      if (hadOwnValue && previousDescriptor) {
        Object.defineProperty(navigator, "hardwareConcurrency", previousDescriptor);
      } else {
        delete navigator.hardwareConcurrency;
      }
    } catch {
      // Restoring a read-only browser property is best-effort.
    }
  };
}

async function flattenOnColor(imageBlob, color) {
  const bitmap = await createImageBitmap(imageBlob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not prepare the download.");
    context.fillStyle = color;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    return await canvasToBlob(canvas);
  } finally {
    bitmap.close?.();
  }
}

function getErasePoint(canvas, event, brushSize, zoom, pan) {
  const surface = canvas.parentElement;
  const stage = surface?.parentElement;
  if (!surface || !stage) return null;
  const stageRect = stage.getBoundingClientRect();
  const frameWidth = surface.offsetWidth;
  const frameHeight = surface.offsetHeight;
  const styles = window.getComputedStyle(canvas);
  const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(styles.paddingRight) || 0;
  const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
  const innerWidth = frameWidth - paddingLeft - paddingRight;
  const innerHeight = frameHeight - paddingTop - paddingBottom;
  const fitScale = Math.min(innerWidth / canvas.width, innerHeight / canvas.height);
  if (!Number.isFinite(fitScale) || fitScale <= 0) return null;

  const imageWidth = canvas.width * fitScale;
  const imageHeight = canvas.height * fitScale;
  const imageLeft = paddingLeft + (innerWidth - imageWidth) / 2;
  const imageTop = paddingTop + (innerHeight - imageHeight) / 2;
  const unscaledX = frameWidth / 2 + (event.clientX - stageRect.left - frameWidth / 2 - pan.x) / zoom;
  const unscaledY = frameHeight / 2 + (event.clientY - stageRect.top - frameHeight / 2 - pan.y) / zoom;
  const x = (unscaledX - imageLeft) / fitScale;
  const y = (unscaledY - imageTop) / fitScale;
  if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) return null;

  return {
    x,
    y,
    radius: (brushSize / 2) / (fitScale * zoom),
    stageX: event.clientX - stageRect.left,
    stageY: event.clientY - stageRect.top,
  };
}

function eraseDot(context, point, radius) {
  context.save();
  context.globalCompositeOperation = "destination-out";
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function eraseSegment(context, from, to, radius) {
  context.save();
  context.globalCompositeOperation = "destination-out";
  context.strokeStyle = "rgba(0, 0, 0, 1)";
  context.lineWidth = radius * 2;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
  context.restore();
}

function paintRestoreMask(maskContext, from, to, radius) {
  maskContext.save();
  maskContext.globalCompositeOperation = "source-over";
  maskContext.fillStyle = "#fff";
  maskContext.strokeStyle = "#fff";
  maskContext.lineWidth = radius * 2;
  maskContext.lineCap = "round";
  maskContext.lineJoin = "round";
  maskContext.beginPath();
  if (Math.hypot(to.x - from.x, to.y - from.y) < 0.01) {
    maskContext.arc(to.x, to.y, radius, 0, Math.PI * 2);
    maskContext.fill();
  } else {
    maskContext.moveTo(from.x, from.y);
    maskContext.lineTo(to.x, to.y);
    maskContext.stroke();
  }
  maskContext.restore();
}

function redrawRestoredRegion(outputCanvas, sourceBitmap, scratchCanvas, maskCanvas, from, to, radius) {
  const x0 = Math.max(0, Math.floor(Math.min(from.x, to.x) - radius - 2));
  const y0 = Math.max(0, Math.floor(Math.min(from.y, to.y) - radius - 2));
  const x1 = Math.min(outputCanvas.width, Math.ceil(Math.max(from.x, to.x) + radius + 2));
  const y1 = Math.min(outputCanvas.height, Math.ceil(Math.max(from.y, to.y) + radius + 2));
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0) return;

  if (scratchCanvas.width < width) scratchCanvas.width = width;
  if (scratchCanvas.height < height) scratchCanvas.height = height;
  if (maskCanvas.width < width) maskCanvas.width = width;
  if (maskCanvas.height < height) maskCanvas.height = height;
  const scratchContext = scratchCanvas.getContext("2d");
  const maskContext = maskCanvas.getContext("2d");
  const outputContext = outputCanvas.getContext("2d");
  if (!scratchContext || !maskContext || !outputContext) return;

  scratchContext.globalCompositeOperation = "source-over";
  scratchContext.clearRect(0, 0, width, height);
  const scaleX = sourceBitmap.width / outputCanvas.width;
  const scaleY = sourceBitmap.height / outputCanvas.height;
  scratchContext.drawImage(
    sourceBitmap,
    x0 * scaleX,
    y0 * scaleY,
    width * scaleX,
    height * scaleY,
    0,
    0,
    width,
    height,
  );

  maskContext.globalCompositeOperation = "source-over";
  maskContext.clearRect(0, 0, width, height);
  paintRestoreMask(
    maskContext,
    { x: from.x - x0, y: from.y - y0 },
    { x: to.x - x0, y: to.y - y0 },
    radius,
  );
  scratchContext.globalCompositeOperation = "destination-in";
  scratchContext.drawImage(maskCanvas, 0, 0, width, height, 0, 0, width, height);
  scratchContext.globalCompositeOperation = "source-over";

  outputContext.save();
  outputContext.globalCompositeOperation = "destination-out";
  outputContext.drawImage(maskCanvas, 0, 0, width, height, x0, y0, width, height);
  outputContext.globalCompositeOperation = "lighter";
  outputContext.drawImage(scratchCanvas, 0, 0, width, height, x0, y0, width, height);
  outputContext.restore();
}

function replayBrushStrokes(outputCanvas, baseBitmap, sourceBitmap, scratchCanvas, maskCanvas, strokes) {
  const context = outputCanvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
  context.globalCompositeOperation = "source-over";
  context.drawImage(baseBitmap, 0, 0);

  for (const stroke of strokes) {
    const mode = stroke.mode === "restore" ? "restore" : "erase";
    const points = stroke.points;
    if (mode === "restore") {
      if (points.length === 1) {
        redrawRestoredRegion(outputCanvas, sourceBitmap, scratchCanvas, maskCanvas, points[0], points[0], stroke.radius);
      } else {
        for (let index = 1; index < points.length; index += 1) {
          redrawRestoredRegion(outputCanvas, sourceBitmap, scratchCanvas, maskCanvas, points[index - 1], points[index], stroke.radius);
        }
      }
    } else if (points.length === 1) {
      eraseDot(context, points[0], stroke.radius);
    } else {
      for (let index = 1; index < points.length; index += 1) {
        eraseSegment(context, points[index - 1], points[index], stroke.radius);
      }
    }
  }
}

function App() {
  const fileInputRef = useRef(null);
  const eraseCanvasRef = useRef(null);
  const zoomSurfaceRef = useRef(null);
  const brushCursorRef = useRef(null);
  const baseBitmapRef = useRef(null);
  const restoreBitmapRef = useRef(null);
  const editMaskRef = useRef(null);
  const scratchCanvasRef = useRef(null);
  const activeEraseStrokeRef = useRef(null);
  const editorReadyRef = useRef(false);
  const panDragRef = useRef(null);
  const editRenderRevisionRef = useRef(0);
  const [source, setSource] = useState(null);
  const [result, setResult] = useState(null);
  const [baseResultBlob, setBaseResultBlob] = useState(null);
  const [restoreSourceBlob, setRestoreSourceBlob] = useState(null);
  const [eraseStrokes, setEraseStrokes] = useState([]);
  const [editMode, setEditMode] = useState(false);
  const [baseBitmapReady, setBaseBitmapReady] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [brushMode, setBrushMode] = useState("erase");
  const [brushSize, setBrushSize] = useState(36);
  const [sourceDimensions, setSourceDimensions] = useState(null);
  const [resultDimensions, setResultDimensions] = useState(null);
  const [preset, setPreset] = useState("fast");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panMode, setPanMode] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [backgroundId, setBackgroundId] = useState("transparent");
  const [comparePosition, setComparePosition] = useState(52);
  const [view, setView] = useState("compare");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState({ label: "", percent: null });
  const [error, setError] = useState("");
  const [errorDetails, setErrorDetails] = useState("");

  const sourceUrl = source?.url;
  const resultUrl = result?.url;
  const selectedBackground = BACKGROUNDS.find((item) => item.id === backgroundId) ?? BACKGROUNDS[0];
  const selectedPreset = SIZE_PRESETS.find((item) => item.id === preset) ?? SIZE_PRESETS[0];
  const zoomSurfaceStyle = { transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` };

  useEffect(() => {
    if (!sourceUrl) return undefined;
    return () => URL.revokeObjectURL(sourceUrl);
  }, [sourceUrl]);

  useEffect(() => {
    if (!resultUrl) return undefined;
    return () => URL.revokeObjectURL(resultUrl);
  }, [resultUrl]);

  useEffect(() => {
    if (!editMode || !baseResultBlob || !source?.file) {
      baseBitmapRef.current?.close?.();
      restoreBitmapRef.current?.close?.();
      baseBitmapRef.current = null;
      restoreBitmapRef.current = null;
      editMaskRef.current = null;
      scratchCanvasRef.current = null;
      return undefined;
    }

    let cancelled = false;
    let loadingBaseBitmap = null;
    createImageBitmap(baseResultBlob)
      .then(async (bitmap) => {
        loadingBaseBitmap = bitmap;
        const sourceBlob = restoreSourceBlob
          ?? await resizeForModel(source.file, Math.max(bitmap.width, bitmap.height));
        const sourceBitmap = await createImageBitmap(sourceBlob);
        return [bitmap, sourceBitmap];
      })
      .then(([bitmap, sourceBitmap]) => {
        if (cancelled) {
          bitmap.close?.();
          sourceBitmap.close?.();
          return;
        }
        baseBitmapRef.current = bitmap;
        restoreBitmapRef.current = sourceBitmap;
        setBaseBitmapReady(true);
      })
      .catch((bitmapError) => {
        loadingBaseBitmap?.close?.();
        if (cancelled) return;
        setError("Could not open the touch-up brushes. Try a different browser or re-run the cutout.");
        setErrorDetails(String(bitmapError?.message ?? bitmapError).slice(0, 320));
        setBaseBitmapReady(false);
        editorReadyRef.current = false;
        setEditorReady(false);
        setEditMode(false);
      });

    return () => {
      cancelled = true;
      baseBitmapRef.current?.close?.();
      restoreBitmapRef.current?.close?.();
      baseBitmapRef.current = null;
      restoreBitmapRef.current = null;
      editMaskRef.current = null;
      scratchCanvasRef.current = null;
    };
  }, [editMode, baseResultBlob, restoreSourceBlob, source]);

  useEffect(() => {
    const canvas = eraseCanvasRef.current;
    const bitmap = baseBitmapRef.current;
    const sourceBitmap = restoreBitmapRef.current;
    if (!editMode || !baseBitmapReady || !canvas || !bitmap || !sourceBitmap || !baseResultBlob) return undefined;

    if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
    if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
    if (!editMaskRef.current) editMaskRef.current = document.createElement("canvas");
    if (!scratchCanvasRef.current) scratchCanvasRef.current = document.createElement("canvas");
    replayBrushStrokes(canvas, bitmap, sourceBitmap, scratchCanvasRef.current, editMaskRef.current, eraseStrokes);

    let readyFrameId;
    if (!editorReadyRef.current) {
      readyFrameId = window.requestAnimationFrame(() => {
        editorReadyRef.current = true;
        setEditorReady(true);
      });
    }

    const revision = ++editRenderRevisionRef.current;
    if (eraseStrokes.length > 0) {
      canvasToBlob(canvas)
        .then((blob) => {
          if (editRenderRevisionRef.current !== revision) return;
          setResult((current) => current ? { blob, url: URL.createObjectURL(blob) } : current);
          setIsSavingEdit(false);
        })
        .catch((blobError) => {
          if (editRenderRevisionRef.current !== revision) return;
          setError("Could not save the brush edit. Please try again.");
          setErrorDetails(String(blobError?.message ?? blobError).slice(0, 320));
          setIsSavingEdit(false);
        });
    }

    return () => {
      if (readyFrameId !== undefined) window.cancelAnimationFrame(readyFrameId);
      if (editRenderRevisionRef.current === revision) editRenderRevisionRef.current += 1;
    };
  }, [editMode, baseBitmapReady, eraseStrokes, baseResultBlob, restoreSourceBlob]);

  function openFilePicker() {
    if (!isProcessing) fileInputRef.current?.click();
  }

  function chooseFile(file) {
    if (!file || isProcessing) return;
    const extensionLooksSupported = /\.(jpe?g|png|webp)$/i.test(file.name);
    if (!IMAGE_TYPES.has(file.type) && !extensionLooksSupported) {
      setError("Please choose a JPG/JPEG, PNG, or WebP image.");
      setErrorDetails("");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError("This image is over 30 MB. Try a smaller file to keep things smooth on this device.");
      setErrorDetails("");
      return;
    }

    setError("");
    setErrorDetails("");
    setResult(null);
    setBaseResultBlob(null);
    setRestoreSourceBlob(null);
    setEraseStrokes([]);
    setEditMode(false);
    setBaseBitmapReady(false);
    editorReadyRef.current = false;
    setEditorReady(false);
    setIsSavingEdit(false);
    setBrushMode("erase");
    activeEraseStrokeRef.current = null;
    setSourceDimensions(null);
    setResultDimensions(null);
    setView("compare");
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setPanMode(false);
    setIsPanning(false);
    panDragRef.current = null;
    setComparePosition(52);
    setSource({ file, url: URL.createObjectURL(file) });
  }

  function handleFileInput(event) {
    const file = event.target.files?.[0];
    if (file) chooseFile(file);
    event.target.value = "";
  }

  function handleDragOver(event) {
    event.preventDefault();
    if (!isProcessing) setIsDragging(true);
  }

  function handleDragLeave(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) setIsDragging(false);
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);
    if (!isProcessing) chooseFile(event.dataTransfer.files?.[0]);
  }

  function openEraseEditor() {
    if (!result || !baseResultBlob || !source?.file || isProcessing) return;
    setError("");
    setErrorDetails("");
    setView("cutout");
    setPanMode(false);
    setBaseBitmapReady(false);
    editorReadyRef.current = false;
    setEditorReady(false);
    setIsSavingEdit(false);
    setEditMode(true);
  }

  function closeEraseEditor() {
    if (isSavingEdit) return;
    activeEraseStrokeRef.current = null;
    setEditMode(false);
    setBaseBitmapReady(false);
    editorReadyRef.current = false;
    setEditorReady(false);
    fitCanvas();
    setView("compare");
    if (brushCursorRef.current) brushCursorRef.current.style.opacity = "0";
  }

  function restoreBaseOutput() {
    if (!baseResultBlob) return;
    editRenderRevisionRef.current += 1;
    setIsSavingEdit(false);
    if (result?.blob !== baseResultBlob) {
      setResult({ blob: baseResultBlob, url: URL.createObjectURL(baseResultBlob) });
    }
  }

  function handleUndoErase() {
    const remainingStrokes = eraseStrokes.slice(0, -1);
    setEraseStrokes(remainingStrokes);
    if (remainingStrokes.length === 0) restoreBaseOutput();
    else setIsSavingEdit(true);
  }

  function handleResetErase() {
    setEraseStrokes([]);
    restoreBaseOutput();
  }

  function updateBrushCursor(point) {
    const cursor = brushCursorRef.current;
    const canvas = eraseCanvasRef.current;
    if (!cursor || !canvas || !point) {
      if (cursor) cursor.style.opacity = "0";
      return;
    }
    cursor.style.left = `${point.stageX}px`;
    cursor.style.top = `${point.stageY}px`;
    cursor.style.opacity = "1";
  }

  function applyLiveBrushStroke(canvas, from, to, stroke) {
    const sourceBitmap = restoreBitmapRef.current;
    const scratchCanvas = scratchCanvasRef.current;
    const maskCanvas = editMaskRef.current;
    const context = canvas.getContext("2d");
    if (!sourceBitmap || !scratchCanvas || !maskCanvas || !context) return;

    if (stroke.mode === "restore") {
      redrawRestoredRegion(canvas, sourceBitmap, scratchCanvas, maskCanvas, from ?? to, to, stroke.radius);
    } else if (from) {
      eraseSegment(context, from, to, stroke.radius);
    } else {
      eraseDot(context, to, stroke.radius);
    }
  }

  function handleErasePointerDown(event) {
    if (panMode || !editorReady || !editMaskRef.current || !baseBitmapRef.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    const canvas = eraseCanvasRef.current;
    const point = canvas && getErasePoint(canvas, event, brushSize, zoom, pan);
    if (!canvas || !point) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const stroke = { mode: brushMode, radius: point.radius, points: [{ x: point.x, y: point.y }] };
    activeEraseStrokeRef.current = { pointerId: event.pointerId, stroke };
    applyLiveBrushStroke(canvas, null, point, stroke);
    updateBrushCursor(point);
  }

  function handleErasePointerMove(event) {
    const canvas = eraseCanvasRef.current;
    if (!canvas || !editorReady || !editMaskRef.current) {
      if (brushCursorRef.current) brushCursorRef.current.style.opacity = "0";
      return;
    }
    if (panMode) {
      if (brushCursorRef.current) brushCursorRef.current.style.opacity = "0";
      return;
    }
    const point = getErasePoint(canvas, event, brushSize, zoom, pan);
    updateBrushCursor(point);

    const active = activeEraseStrokeRef.current;
    if (!active || active.pointerId !== event.pointerId || !point) return;
    const lastPoint = active.stroke.points[active.stroke.points.length - 1];
    if (Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) < 0.5) return;
    active.stroke.points.push({ x: point.x, y: point.y });
    applyLiveBrushStroke(canvas, lastPoint, point, active.stroke);
  }

  function finishErasePointer(event) {
    const active = activeEraseStrokeRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const canvas = eraseCanvasRef.current;
    const point = canvas && getErasePoint(canvas, event, brushSize, zoom, pan);
    if (point) {
      const lastPoint = active.stroke.points[active.stroke.points.length - 1];
      if (Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) >= 0.5) {
        active.stroke.points.push({ x: point.x, y: point.y });
        applyLiveBrushStroke(canvas, lastPoint, point, active.stroke);
      }
    }
    activeEraseStrokeRef.current = null;
    setEraseStrokes((current) => [...current, {
      mode: active.stroke.mode,
      radius: active.stroke.radius,
      points: active.stroke.points.map((strokePoint) => ({ ...strokePoint })),
    }]);
    setIsSavingEdit(true);
    if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }

  function leaveEraseCanvas() {
    if (!activeEraseStrokeRef.current && brushCursorRef.current) brushCursorRef.current.style.opacity = "0";
  }

  function fitCanvas() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setPanMode(false);
    setIsPanning(false);
    panDragRef.current = null;
  }

  function changeZoom(delta) {
    const nextZoom = Math.max(1, Math.min(4, Math.round((zoom + delta) * 100) / 100));
    if (nextZoom > 1 && result && view === "compare") setView("cutout");
    setZoom(nextZoom);
    setPanMode(false);
    setIsPanning(false);
    panDragRef.current = null;
    if (nextZoom === 1) setPan({ x: 0, y: 0 });
  }

  function togglePanMode() {
    const nextPanMode = !panMode;
    setPanMode(nextPanMode);
    if (nextPanMode && brushCursorRef.current) brushCursorRef.current.style.opacity = "0";
  }

  function handleCanvasWheel(event) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    changeZoom(event.deltaY < 0 ? 0.25 : -0.25);
  }

  function handlePanPointerDown(event) {
    if (!panMode || zoom <= 1) return;
    if (event.target instanceof Element && event.target.closest(".canvas-zoom-controls")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: pan };
    setIsPanning(true);
    if (brushCursorRef.current) brushCursorRef.current.style.opacity = "0";
  }

  function handlePanPointerMove(event) {
    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const stage = zoomSurfaceRef.current?.parentElement;
    const bounds = stage?.getBoundingClientRect();
    if (!bounds) return;
    const maxX = (bounds.width * (zoom - 1)) / 2;
    const maxY = (bounds.height * (zoom - 1)) / 2;
    const nextX = drag.origin.x + event.clientX - drag.startX;
    const nextY = drag.origin.y + event.clientY - drag.startY;
    setPan({
      x: Math.max(-maxX, Math.min(maxX, nextX)),
      y: Math.max(-maxY, Math.min(maxY, nextY)),
    });
  }

  function finishPanPointer(event) {
    if (!panDragRef.current || panDragRef.current.pointerId !== event.pointerId) return;
    panDragRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  async function handleRemoveBackground() {
    if (!source || isProcessing) return;
    setIsProcessing(true);
    setEditMode(false);
    setBaseBitmapReady(false);
    editorReadyRef.current = false;
    setEditorReady(false);
    setIsSavingEdit(false);
    activeEraseStrokeRef.current = null;
    setError("");
    setErrorDetails("");
    setProgress({ label: "Preparing a light version of your image", percent: null });
    const restoreThreadCount = limitThreadsForCurrentContext();

    try {
      const modelInput = await resizeForModel(source.file, selectedPreset.maxSide);
      setProgress({ label: "Loading the image engine", percent: null });
      const { removeBackground } = await import("@imgly/background-removal");
      setProgress({ label: "Starting the on-device AI", percent: null });

      const rgbaBlob = await removeBackground(modelInput, {
        publicPath: new URL(`${import.meta.env.BASE_URL}background-removal-data/`, window.location.href).toString(),
        model: "isnet_fp16",
        device: "cpu",
        output: { format: "image/x-rgba8" },
        progress: (key, current, total) => {
          const totalValue = Number(total);
          const currentValue = Number(current);
          const percent = totalValue > 0 && Number.isFinite(currentValue)
            ? Math.max(0, Math.min(100, Math.round((currentValue / totalValue) * 100)))
            : null;
          setProgress({ label: getProgressLabel(key), percent });
        },
      });

      setProgress({ label: "Protecting text and fine details on white backgrounds", percent: null });
      const outputBlob = await refineAndEncodeRgbaBlob(rgbaBlob);
      setBaseResultBlob(outputBlob);
      setRestoreSourceBlob(modelInput);
      setEraseStrokes([]);
      setBaseBitmapReady(false);
      editorReadyRef.current = false;
      setEditorReady(false);
      setResult({ blob: outputBlob, url: URL.createObjectURL(outputBlob) });
      fitCanvas();
      setView("compare");
      setComparePosition(52);
    } catch (processingError) {
      console.error("Background removal failed:", processingError);
      setError("Could not create the cutout. Check the technical details below, then try again.");
      setErrorDetails(String(processingError?.message ?? processingError).slice(0, 320));
    } finally {
      restoreThreadCount();
      setIsProcessing(false);
      setProgress({ label: "", percent: null });
    }
  }

  async function handleDownload() {
    if (!result || isExporting || editMode || isSavingEdit) return;
    setIsExporting(true);
    setError("");
    setErrorDetails("");

    try {
      const downloadBlob = selectedBackground.color
        ? await flattenOnColor(result.blob, selectedBackground.color)
        : result.blob;
      const downloadUrl = URL.createObjectURL(downloadBlob);
      const anchor = document.createElement("a");
      const baseName = source?.file.name.replace(/\.[^.]+$/, "") || "cutout";
      anchor.href = downloadUrl;
      anchor.download = `${baseName}-cutout.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch (downloadError) {
      console.error("PNG export failed:", downloadError);
      setError("Could not prepare the PNG download. Please try again.");
      setErrorDetails(String(downloadError?.message ?? downloadError).slice(0, 320));
    } finally {
      setIsExporting(false);
    }
  }

  const imageStageStyle = selectedBackground.color
    ? { backgroundColor: selectedBackground.color }
    : undefined;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Flipibook BG remover home">
          <span className="brand-mark"><span /><span /><span /><span /></span>
          <span className="brand-name">Flipibook</span>
          <span className="brand-caption">BG Remover</span>
        </a>
        <div className="local-pill"><span className="local-dot" /> LOCAL AI <span className="pill-divider">·</span> NO API</div>
      </header>

      <main id="top" className="page-content">
        <section id="workbench" className="workbench" aria-labelledby="workbench-heading">
          <div className="workbench-heading">
            <div className="workbench-title-wrap">
              <span className="workbench-index"><Icon name="image" size={15} /></span>
              <div>
                <p className="section-kicker">FLIPIBOOK BG REMOVER</p>
                <h2 id="workbench-heading">Remove background</h2>
              </div>
            </div>
            <div className="workbench-security"><Icon name="lock" size={14} /> Runs in this browser tab</div>
          </div>

          <div className="workspace-grid">
            <section className="preview-column" aria-label="Image preview">
              <div className="preview-toolbar">
                <div className="preview-file-label">
                  <span className="preview-file-icon"><Icon name="image" size={16} /></span>
                  <div className="preview-file-text">
                    <span className="preview-file-name" title={source?.file.name ?? "Preview stage"}>{source?.file.name ?? "Preview stage"}</span>
                    <span className="preview-file-subtitle">{source ? (sourceDimensions ? formatDimensions(sourceDimensions) : "Original image") : "Drop an image to get started"}</span>
                  </div>
                </div>
                <div className="preview-toolbar-right">
                  {source && result && !isProcessing && !editMode && (
                    <div className="view-toggle" role="group" aria-label="Preview mode">
                      <button type="button" className={view === "compare" ? "active" : ""} onClick={() => { fitCanvas(); setView("compare"); }} aria-pressed={view === "compare"}>Compare</button>
                      <button type="button" className={view === "cutout" ? "active" : ""} onClick={() => setView("cutout")} aria-pressed={view === "cutout"}>Cutout</button>
                    </div>
                  )}
                  <span className={`status-tag ${isProcessing ? "status-working" : editMode ? "status-editing" : result ? "status-ready" : ""}`}>
                    <span className="status-dot" />
                    {isProcessing ? "WORKING" : editMode ? "EDITING" : result ? "CUTOUT READY" : source ? "IMAGE READY" : "EMPTY"}
                  </span>
                </div>
              </div>

              <div
                className={`preview-canvas ${isDragging ? "is-dragging" : ""} ${source ? "has-source" : "is-empty"}`}
                onDragEnter={handleDragOver}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {source ? (
                  <div
                    className={`image-stage ${backgroundId === "transparent" ? "checkerboard" : ""} ${panMode && zoom > 1 ? "pan-mode" : ""} ${isPanning ? "is-panning" : ""}`}
                    style={imageStageStyle}
                    onPointerDown={handlePanPointerDown}
                    onPointerMove={handlePanPointerMove}
                    onPointerUp={finishPanPointer}
                    onPointerCancel={finishPanPointer}
                    onWheel={handleCanvasWheel}
                  >
                    <div ref={zoomSurfaceRef} className={`zoom-surface ${isPanning ? "is-panning" : ""}`} style={zoomSurfaceStyle}>
                    {editMode && result && !isProcessing ? (
                      <>
                        <canvas
                          ref={eraseCanvasRef}
                          className="stage-image erase-canvas"
                          onPointerDown={handleErasePointerDown}
                          onPointerMove={handleErasePointerMove}
                          onPointerUp={finishErasePointer}
                          onPointerCancel={finishErasePointer}
                          onPointerLeave={leaveEraseCanvas}
                          aria-label={`Cutout editing surface. Drag with the ${brushMode} brush.`}
                        />
                        <span className="image-label image-label-before brush-mode-label">{brushMode === "restore" ? "Restore mode" : "Erase mode"}</span>
                        {!editorReady && <div className="editor-loading"><span className="button-spinner" /> Preparing brush…</div>}
                      </>
                    ) : result && view === "compare" && !isProcessing ? (
                      <>
                        <img
                          className="stage-image cutout-image"
                          src={result.url}
                          alt="Background-removed cutout preview"
                          onLoad={(event) => setResultDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
                        />
                        <div className="original-layer" style={{ clipPath: `inset(0 ${100 - comparePosition}% 0 0)` }}>
                          <img
                            className="stage-image"
                            src={source.url}
                            alt="Original image"
                            onLoad={(event) => setSourceDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
                          />
                        </div>
                        <div className="compare-divider" style={{ left: `${comparePosition}%` }} aria-hidden="true">
                          <span><span className="handle-arrow left-arrow" /><span className="handle-arrow right-arrow" /></span>
                        </div>
                        <input
                          className="compare-range"
                          type="range"
                          min="0"
                          max="100"
                          value={comparePosition}
                          onChange={(event) => setComparePosition(Number(event.target.value))}
                          aria-label="Compare original image with background removed"
                        />
                        <span className="image-label image-label-before">Original</span>
                        <span className="image-label image-label-after">Cutout</span>
                      </>
                    ) : (
                      <img
                        className="stage-image"
                        src={result && view === "cutout" && !isProcessing ? result.url : source.url}
                        alt={result && view === "cutout" && !isProcessing ? "Background-removed cutout preview" : "Original image preview"}
                        onLoad={(event) => {
                          const dimensions = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight };
                          if (result && view === "cutout" && !isProcessing) setResultDimensions(dimensions);
                          else setSourceDimensions(dimensions);
                        }}
                      />
                    )}
                    </div>

                    {editMode && result && <div ref={brushCursorRef} className="brush-cursor" style={{ width: `${brushSize}px`, height: `${brushSize}px` }} aria-hidden="true" />}
                    <div className="canvas-zoom-controls" role="group" aria-label="Canvas zoom" onPointerDown={(event) => event.stopPropagation()}>
                      <button type="button" onClick={() => changeZoom(-0.25)} disabled={zoom <= 1} aria-label="Zoom out" title="Zoom out">−</button>
                      <span>{Math.round(zoom * 100)}%</span>
                      <button type="button" onClick={() => changeZoom(0.25)} disabled={zoom >= 4} aria-label="Zoom in" title="Zoom in">+</button>
                      <button type="button" className="zoom-fit-button" onClick={fitCanvas} aria-label="Fit canvas" title="Reset zoom">Fit</button>
                      {zoom > 1 && <button type="button" className={`pan-toggle ${panMode ? "active" : ""}`} onClick={togglePanMode} aria-pressed={panMode} title="Toggle drag-to-pan">Pan</button>}
                    </div>

                    {isProcessing && (
                      <div className="processing-overlay" role="status" aria-live="polite">
                        <div className="processing-card">
                          <span className="spinner" aria-hidden="true" />
                          <div className="processing-copy">
                            <strong>{progress.label || "Working on your cutout"}</strong>
                            <span>First run can take a little longer while the model loads.</span>
                            <div className="progress-track" aria-label={progress.percent === null ? "Processing" : `${progress.percent}%`}>
                              <span className={progress.percent === null ? "indeterminate" : ""} style={progress.percent === null ? undefined : { width: `${progress.percent}%` }} />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {isDragging && <div className="drop-replace-hint"><Icon name="upload" size={18} /> Drop to use this image</div>}
                  </div>
                ) : (
                  <div className="empty-preview-content">
                    <div className="empty-illustration" aria-hidden="true">
                      <span className="illustration-back" />
                      <span className="illustration-front"><Icon name="image" size={29} /></span>
                      <span className="illustration-spark"><Icon name="sparkle" size={17} /></span>
                    </div>
                    <strong>Remove a photo background</strong>
                    <span>Choose an image or drop it into this preview.</span>
                    <button type="button" className="empty-browse-button" onClick={openFilePicker}><Icon name="upload" size={16} /> Choose an image</button>
                    <small>Supported: JPG/JPEG, PNG, WebP <span>·</span> max 30 MB</small>
                  </div>
                )}
              </div>

              <div className="preview-footer">
                <span className="preview-footer-left">
                  <span className="tiny-check"><Icon name="check" size={11} /></span>
                  {source ? (resultDimensions ? formatDimensions(resultDimensions) : formatBytes(source.file.size)) : "Your image never leaves this tab"}
                </span>
                <span className="preview-footer-right">{result ? "PNG · ready to save" : source ? "Original preview" : "Transparent PNG output"}</span>
              </div>
            </section>

            <aside className="control-column" aria-label="Image controls">
              <div className="control-block upload-block">
                <div className="control-heading-row">
                  <div>
                    <p className="section-kicker">STEP 1</p>
                    <h3>Your image</h3>
                  </div>
                  {source && <button className="icon-button" type="button" onClick={openFilePicker} disabled={isProcessing} aria-label="Replace image" title="Replace image"><Icon name="refresh" size={16} /></button>}
                </div>

                <input
                  ref={fileInputRef}
                  className="visually-hidden"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                  onChange={handleFileInput}
                  disabled={isProcessing}
                  aria-label="Choose a JPG or JPEG, PNG, or WebP image"
                />

                {source ? (
                  <div className="selected-file-card">
                    <div className="file-thumbnail"><img src={source.url} alt="" /></div>
                    <div className="selected-file-info">
                      <strong title={source.file.name}>{source.file.name}</strong>
                      <span>{formatBytes(source.file.size)}{sourceDimensions ? ` · ${formatDimensions(sourceDimensions)}` : ""}</span>
                    </div>
                    <span className="file-check"><Icon name="check" size={13} /></span>
                  </div>
                ) : (
                  <button className="upload-dropzone" type="button" onClick={openFilePicker}>
                    <span className="upload-dropzone-icon"><Icon name="upload" size={20} /></span>
                    <span className="upload-dropzone-title">Choose a photo</span>
                    <span className="upload-dropzone-note">JPG/JPEG · PNG · WebP · up to 30 MB</span>
                  </button>
                )}

                <div className="supported-files" aria-label="Supported files: JPG or JPEG, PNG, and WebP; maximum 30 megabytes">
                  <span className="supported-files-title">Supported files</span>
                  <div className="supported-file-pills"><span>JPG/JPEG</span><span>PNG</span><span>WebP</span></div>
                  <span className="supported-files-limit">Max 30 MB</span>
                </div>

                <button className="primary-button" type="button" onClick={handleRemoveBackground} disabled={!source || isProcessing}>
                  {isProcessing ? <span className="button-spinner" /> : <Icon name="sparkle" size={17} />}
                  {isProcessing ? "Removing background…" : result ? "Run again" : "Remove background"}
                  {!isProcessing && <span className="button-arrow">↗</span>}
                </button>
                <p className="action-caption">{result ? "Re-run with your current output-size setting." : "Runs locally; a white-background check preserves high-contrast text and edges."}</p>
              </div>

              {error && (
                <div className="error-message" role="alert">
                  <Icon name="close" size={15} />
                  <div className="error-copy">
                    <span>{error}</span>
                    {errorDetails && <details><summary>Technical details</summary><code>{errorDetails}</code></details>}
                  </div>
                </div>
              )}

              <div className="control-divider" />

              <div className="control-block settings-block">
                <div className="setting-heading">
                  <div>
                    <p className="section-kicker">STEP 2</p>
                    <h3>Keep it lightweight</h3>
                  </div>
                </div>
                <p className="setting-description">Choose the output size that suits your computer.</p>
                <div className="size-options" role="group" aria-label="Output size">
                  {SIZE_PRESETS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`size-option ${preset === option.id ? "selected" : ""}`}
                      onClick={() => setPreset(option.id)}
                      disabled={isProcessing}
                      aria-pressed={preset === option.id}
                    >
                      <span className="size-option-top"><strong>{option.title}</strong>{option.id === "fast" && <span className="recommended-tag">EASIEST</span>}</span>
                      <span>{option.detail} long edge</span>
                    </button>
                  ))}
                </div>

                <div className="background-heading">
                  <div>
                    <p className="section-kicker">PREVIEW & EXPORT</p>
                    <h3>Background</h3>
                  </div>
                  <span className="background-current">{selectedBackground.label}</span>
                </div>
                <div className="swatch-row" role="group" aria-label="Preview background color">
                  {BACKGROUNDS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`background-swatch ${option.id === "transparent" ? "swatch-transparent" : ""} ${backgroundId === option.id ? "selected" : ""}`}
                      style={option.color ? { "--swatch-color": option.color } : undefined}
                      onClick={() => setBackgroundId(option.id)}
                      aria-label={option.label}
                      aria-pressed={backgroundId === option.id}
                      title={option.label}
                    >
                      {backgroundId === option.id && <Icon name="check" size={14} />}
                    </button>
                  ))}
                </div>
                <p className="setting-footnote">Transparent keeps the alpha channel. A color swatch flattens the saved PNG.</p>
              </div>

              {result && (
                <div className="touchup-panel">
                  <div className="touchup-heading">
                    <div><p className="section-kicker">OPTIONAL TOUCH-UP</p><h3>Erase or restore pixels</h3></div>
                    {editMode && <span className="stroke-count">{eraseStrokes.length} {eraseStrokes.length === 1 ? "stroke" : "strokes"}</span>}
                  </div>
                  {editMode ? (
                    <>
                      <div className="brush-mode-switch" role="group" aria-label="Brush mode">
                        <button
                          type="button"
                          className={`brush-mode-button ${brushMode === "erase" ? "active" : ""}`}
                          onClick={() => setBrushMode("erase")}
                          aria-pressed={brushMode === "erase"}
                        >
                          <Icon name="eraser" size={14} /> Erase
                        </button>
                        <button
                          type="button"
                          className={`brush-mode-button ${brushMode === "restore" ? "active restore-active" : ""}`}
                          onClick={() => setBrushMode("restore")}
                          aria-pressed={brushMode === "restore"}
                        >
                          <Icon name="refresh" size={14} /> Restore
                        </button>
                      </div>
                      <label className="brush-size-label" htmlFor="erase-brush-size"><span>Brush size</span><output>{brushSize} px</output></label>
                      <input
                        id="erase-brush-size"
                        className="brush-size-slider"
                        type="range"
                        min="10"
                        max="84"
                        step="2"
                        value={brushSize}
                        onChange={(event) => setBrushSize(Number(event.target.value))}
                        aria-label={`${brushMode === "restore" ? "Restore" : "Erase"} brush diameter`}
                      />
                      <div className="brush-actions">
                        <button type="button" className="tool-text-button" onClick={handleUndoErase} disabled={eraseStrokes.length === 0 || isSavingEdit}>Undo</button>
                        <button type="button" className="tool-text-button" onClick={handleResetErase} disabled={eraseStrokes.length === 0 || isSavingEdit}>Reset</button>
                        <button type="button" className="brush-done-button" onClick={closeEraseEditor} disabled={isSavingEdit}>{isSavingEdit ? "Saving…" : "Done"}</button>
                      </div>
                      <p className="setting-footnote">
                        {brushMode === "restore"
                          ? "Paint over a missing area to restore original-photo pixels; background under the brush comes back too."
                          : "Paint over stray pixels to erase them. Switch to Restore to bring back missing details."}
                        {" "}Undo reverses the last stroke.
                      </p>
                    </>
                  ) : (
                    <>
                      <button type="button" className="erase-launch-button" onClick={openEraseEditor} disabled={isProcessing || !source}>
                        <Icon name="eraser" size={16} /> Open touch-up brushes
                      </button>
                      <p className="setting-footnote">Erase stray pixels or restore details from the original photo. Edits stay on this device.</p>
                    </>
                  )}
                </div>
              )}

              {result && (
                <div className="download-panel">
                  <div className="download-panel-copy"><span className="download-ready-icon"><Icon name="check" size={14} /></span><span><strong>Looks good?</strong><small>Save your cutout as a PNG.</small></span></div>
                  <button className="download-button" type="button" onClick={handleDownload} disabled={isExporting || editMode || isSavingEdit}>
                    <Icon name="download" size={17} /> {isExporting ? "Preparing…" : editMode ? "Finish edits to download" : isSavingEdit ? "Saving edits…" : "Download PNG"}
                  </button>
                </div>
              )}

              <div className="privacy-note" id="privacy">
                <span className="privacy-note-icon"><Icon name="shield" size={17} /></span>
                <div><strong>Your photo stays yours.</strong><span>The AI model is bundled with this app. Your image is processed locally and is never uploaded.</span></div>
              </div>
            </aside>
          </div>
        </section>

      </main>
    </div>
  );
}

export default App;
