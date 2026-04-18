import React, { useState, useEffect, useRef, useCallback } from "react";

// ============================================================
// Cloudinary Configuration
// ============================================================
const CLOUD_NAME = "dwpd1t6gn";
const API_KEY = "554611444367187";
const API_SECRET = "69nU7DD2kfc_eBRXDvB3WDWQxQI";
const UPLOAD_PRESET = "memory_board";
const TAG = "memory_board";
const UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;
const LIST_URL = `https://res.cloudinary.com/${CLOUD_NAME}/image/list/${TAG}.json`;
const DESTROY_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/destroy`;

// ============================================================
// SHA-1 signature helper (for signed delete)
// ============================================================
async function sha1(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function deleteFromCloudinary(publicId: string): Promise<void> {
  const timestamp = Math.floor(Date.now() / 1000);
  const toSign = `public_id=${publicId}&timestamp=${timestamp}${API_SECRET}`;
  const signature = await sha1(toSign);
  const formData = new FormData();
  formData.append("public_id", publicId);
  formData.append("timestamp", String(timestamp));
  formData.append("api_key", API_KEY);
  formData.append("signature", signature);
  const res = await fetch(DESTROY_URL, { method: "POST", body: formData });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data?.error?.message || "删除失败");
  }
}

// ============================================================
// Types
// ============================================================
interface PhotoData {
  id: string;
  url: string;
  width: number;
  height: number;
  createdAt: string;
}

interface PhotoLayout {
  id: string;
  x: number;
  y: number;
  rot: number;
  zIndex: number;
}

// ============================================================
// Heart shape positions (parametric)
// ============================================================
function getHeartPoints(count: number): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * 2 * Math.PI;
    const hx = 16 * Math.pow(Math.sin(t), 3);
    const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    points.push({ x: hx, y: hy });
  }
  return points;
}

// ============================================================
// Helpers
// ============================================================
function getStoredLayouts(): Record<string, PhotoLayout> {
  try {
    const raw = localStorage.getItem("memory_board_layouts_v2");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveLayouts(layouts: Record<string, PhotoLayout>) {
  try {
    localStorage.setItem("memory_board_layouts_v2", JSON.stringify(layouts));
  } catch {}
}

function generateLayout(id: string, index: number, total: number): PhotoLayout {
  const cols = Math.max(4, Math.ceil(Math.sqrt(total)));
  const cellW = 300;
  const cellH = 340;
  const col = index % cols;
  const row = Math.floor(index / cols);
  const x = col * cellW + (Math.random() * 60 - 30);
  const y = row * cellH + (Math.random() * 60 - 30);
  const rot = Math.random() * 18 - 9;
  return { id, x, y, rot, zIndex: index + 1 };
}

function buildCloudinaryUrl(publicId: string): string {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${publicId}`;
}

// ============================================================
// Custom Confirm Dialog
// ============================================================
interface ConfirmDialogProps {
  message: string;
  subMessage?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  confirmDanger?: boolean;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  message,
  subMessage,
  onConfirm,
  onCancel,
  confirmLabel = "确定删除",
  confirmDanger = true,
}) => (
  <div
    onPointerDown={(e) => e.stopPropagation()}
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.55)",
      zIndex: 99998,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
    onClick={onCancel}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: "white",
        borderRadius: 18,
        padding: "28px 32px 22px",
        maxWidth: 360,
        width: "90vw",
        textAlign: "center",
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
      }}
    >
      <div style={{ fontSize: 38, marginBottom: 12 }}>🗑️</div>
      <p style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 700, color: "#333" }}>
        {message}
      </p>
      {subMessage && (
        <p style={{ margin: "0 0 20px", fontSize: 13, color: "#888" }}>{subMessage}</p>
      )}
      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        <button
          onClick={onCancel}
          style={{
            padding: "10px 24px",
            borderRadius: 24,
            border: "1.5px solid #ddd",
            background: "white",
            color: "#666",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          取消
        </button>
        <button
          onClick={onConfirm}
          style={{
            padding: "10px 24px",
            borderRadius: 24,
            border: "none",
            background: confirmDanger
              ? "linear-gradient(135deg,#e53e3e,#c0392b)"
              : "linear-gradient(135deg,#9b59b6,#e91e8c)",
            color: "white",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: confirmDanger
              ? "0 3px 12px rgba(229,62,62,0.45)"
              : "0 3px 12px rgba(155,89,182,0.45)",
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
);

// ============================================================
// Individual Draggable Polaroid
// ============================================================
interface PolaroidProps {
  photo: PhotoData;
  layout: PhotoLayout;
  isActive: boolean;
  isBatchSelected: boolean;
  isBatchMode: boolean;
  scale: number;
  onActivate: (id: string) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onClickPhoto: (photo: PhotoData) => void;
  onToggleBatchSelect: (id: string) => void;
}

const Polaroid: React.FC<PolaroidProps> = ({
  photo,
  layout,
  isActive,
  isBatchSelected,
  isBatchMode,
  scale,
  onActivate,
  onDragEnd,
  onClickPhoto,
  onToggleBatchSelect,
}) => {
  const [dragging, setDragging] = useState(false);
  const [pos, setPos] = useState({ x: layout.x, y: layout.y });
  const dragRef = useRef({ startX: 0, startY: 0, initX: 0, initY: 0, moved: false });
  const nodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPos({ x: layout.x, y: layout.y });
  }, [layout.x, layout.y]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      if (isBatchMode) {
        onToggleBatchSelect(photo.id);
        return;
      }
      onActivate(photo.id);
      setDragging(true);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        initX: pos.x,
        initY: pos.y,
        moved: false,
      };
      nodeRef.current?.setPointerCapture(e.pointerId);
    },
    [onActivate, photo.id, pos.x, pos.y, isBatchMode, onToggleBatchSelect]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      e.stopPropagation();
      const dx = (e.clientX - dragRef.current.startX) / scale;
      const dy = (e.clientY - dragRef.current.startY) / scale;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragRef.current.moved = true;
      setPos({
        x: dragRef.current.initX + dx,
        y: dragRef.current.initY + dy,
      });
    },
    [dragging, scale]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      e.stopPropagation();
      setDragging(false);
      if (!dragRef.current.moved) {
        onClickPhoto(photo);
      } else {
        onDragEnd(photo.id, pos.x, pos.y);
      }
    },
    [dragging, onDragEnd, onClickPhoto, photo, pos.x, pos.y]
  );

  const maxW = 200;
  const aspectRatio = photo.width && photo.height ? photo.width / photo.height : 4 / 3;
  const imgH = Math.round(maxW / aspectRatio);

  const borderColor = isBatchSelected
    ? "#e91e8c"
    : isActive
    ? "#9b59b6"
    : "transparent";

  return (
    <div
      ref={nodeRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y,
        transform: `translate(-50%, -50%) rotate(${isBatchSelected || isActive ? 0 : layout.rot}deg) scale(${isActive && !isBatchMode ? 1.06 : isBatchSelected ? 1.04 : 1})`,
        zIndex: isActive ? 9999 : isBatchSelected ? 9000 : layout.zIndex,
        transition: dragging ? "none" : "transform 0.3s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.3s ease",
        cursor: isBatchMode ? "pointer" : dragging ? "grabbing" : "grab",
        userSelect: "none",
        touchAction: "none",
      }}
    >
      <div
        style={{
          width: maxW + 20,
          background: "white",
          padding: "10px 10px 10px 10px",
          boxShadow: isBatchSelected
            ? `0 0 0 3px ${borderColor}, 4px 8px 28px rgba(233,30,140,0.28)`
            : isActive && !isBatchMode
            ? "4px 8px 28px rgba(0,0,0,0.38)"
            : "2px 4px 14px rgba(0,0,0,0.18)",
          position: "relative",
          outline: `3px solid ${borderColor}`,
          borderRadius: 2,
          transition: "outline 0.15s, box-shadow 0.2s",
        }}
      >
        {/* Tape */}
        <div
          style={{
            position: "absolute",
            top: -11,
            left: "50%",
            transform: "translateX(-50%) rotate(1deg)",
            width: 64,
            height: 20,
            background: "rgba(255,255,200,0.55)",
            border: "1px solid rgba(200,200,100,0.4)",
            pointerEvents: "none",
          }}
        />

        {/* Image */}
        <div
          style={{
            width: maxW,
            height: imgH,
            overflow: "hidden",
            background: "#f0ece4",
            position: "relative",
          }}
        >
          <img
            src={photo.url}
            alt=""
            draggable={false}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              display: "block",
              pointerEvents: "none",
              userSelect: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(135deg,rgba(255,255,255,0.13) 0%,transparent 60%)",
              pointerEvents: "none",
            }}
          />
          {/* Batch select checkmark overlay */}
          {isBatchMode && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: isBatchSelected
                  ? "rgba(233,30,140,0.18)"
                  : "rgba(0,0,0,0.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 0.2s",
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  border: `3px solid ${isBatchSelected ? "#e91e8c" : "white"}`,
                  background: isBatchSelected
                    ? "linear-gradient(135deg,#e91e8c,#9b59b6)"
                    : "rgba(255,255,255,0.6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  color: "white",
                  fontWeight: 900,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
                  transition: "all 0.2s",
                }}
              >
                {isBatchSelected ? "✓" : ""}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Upload Panel
// ============================================================
interface UploadPanelProps {
  onUploadSuccess: (photo: PhotoData) => void;
  onClose: () => void;
}

const UploadPanel: React.FC<UploadPanelProps> = ({ onUploadSuccess, onClose }) => {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [successCount, setSuccessCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("请选择图片文件");
      return;
    }
    setUploading(true);
    setError("");
    setProgress(10);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", UPLOAD_PRESET);
      formData.append("tags", TAG);
      setProgress(30);
      const res = await fetch(UPLOAD_URL, { method: "POST", body: formData });
      setProgress(85);
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData?.error?.message || "上传失败");
      }
      const data = await res.json();
      setProgress(100);
      const photo: PhotoData = {
        id: data.public_id,
        url: data.secure_url,
        width: data.width,
        height: data.height,
        createdAt: data.created_at,
      };
      onUploadSuccess(photo);
      setSuccessCount((c) => c + 1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "上传失败，请重试");
    } finally {
      setUploading(false);
      setTimeout(() => setProgress(0), 800);
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach(uploadFile);
  };

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        background: "rgba(255,255,255,0.96)",
        backdropFilter: "blur(12px)",
        borderRadius: 16,
        padding: "18px 20px 16px",
        boxShadow: "0 6px 30px rgba(0,0,0,0.18)",
        minWidth: 240,
        position: "relative",
      }}
    >
      <button
        onClick={onClose}
        style={{
          position: "absolute",
          top: 10,
          right: 12,
          background: "none",
          border: "none",
          fontSize: 18,
          cursor: "pointer",
          color: "#999",
          lineHeight: 1,
        }}
      >
        ✕
      </button>
      <p style={{ margin: "0 0 12px", fontWeight: 700, fontSize: 15, color: "#333", textAlign: "center" }}>
        📷 上传照片
      </p>
      {successCount > 0 && (
        <p style={{ margin: "0 0 8px", fontSize: 12, color: "#27ae60", textAlign: "center" }}>
          ✅ 已成功上传 {successCount} 张
        </p>
      )}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        style={{
          border: `2px dashed ${dragOver ? "#9b59b6" : "#c9b99a"}`,
          borderRadius: 10,
          padding: "18px 10px",
          textAlign: "center",
          cursor: "pointer",
          background: dragOver ? "#f5eeff" : "#faf7f2",
          transition: "all 0.2s",
          marginBottom: 8,
        }}
      >
        {uploading ? (
          <div>
            <div style={{ height: 6, background: "#e8e0d4", borderRadius: 3, overflow: "hidden", marginBottom: 6 }}>
              <div
                style={{
                  height: "100%",
                  width: `${progress}%`,
                  background: "linear-gradient(90deg,#9b59b6,#e91e8c)",
                  borderRadius: 3,
                  transition: "width 0.3s",
                }}
              />
            </div>
            <p style={{ margin: 0, fontSize: 12, color: "#888" }}>上传中... {progress}%</p>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 30, marginBottom: 6 }}>🖼️</div>
            <p style={{ margin: 0, fontSize: 12, color: "#888" }}>点击或拖拽照片到这里</p>
            <p style={{ margin: "3px 0 0", fontSize: 11, color: "#aaa" }}>支持多选</p>
          </>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => handleFiles(e.target.files)}
      />
      {error && (
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "#e53e3e", textAlign: "center" }}>
          ⚠️ {error}
        </p>
      )}
    </div>
  );
};

// ============================================================
// Lightbox (fullscreen view + delete button)
// ============================================================
interface LightboxProps {
  photo: PhotoData;
  onClose: () => void;
  onDelete: (id: string) => void;
}

const Lightbox: React.FC<LightboxProps> = ({ photo, onClose, onDelete }) => {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.88)",
          zIndex: 99999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "zoom-out",
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 18,
            right: 22,
            background: "rgba(255,255,255,0.15)",
            border: "none",
            borderRadius: "50%",
            width: 44,
            height: 44,
            fontSize: 20,
            color: "white",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backdropFilter: "blur(4px)",
            zIndex: 100001,
          }}
        >
          ✕
        </button>

        {/* Delete button — beside the image */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setConfirmDelete(true);
          }}
          style={{
            position: "absolute",
            bottom: 30,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(229,62,62,0.9)",
            border: "none",
            borderRadius: 28,
            padding: "12px 28px",
            color: "white",
            fontSize: 15,
            fontWeight: 700,
            cursor: "pointer",
            backdropFilter: "blur(8px)",
            boxShadow: "0 4px 20px rgba(229,62,62,0.5)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            zIndex: 100001,
          }}
        >
          🗑️ 删除这张照片
        </button>

        {/* Image */}
        <img
          src={photo.url}
          alt=""
          onClick={(e) => e.stopPropagation()}
          style={{
            maxWidth: "90vw",
            maxHeight: "78vh",
            objectFit: "contain",
            borderRadius: 4,
            boxShadow: "0 8px 60px rgba(0,0,0,0.6)",
            cursor: "default",
          }}
        />
      </div>

      {/* Confirm delete dialog */}
      {confirmDelete && (
        <ConfirmDialog
          message="确定要删除这张照片吗？"
          subMessage="删除后将永久从云端移除，无法恢复。"
          confirmLabel="确定删除"
          onConfirm={() => {
            setConfirmDelete(false);
            onClose();
            onDelete(photo.id);
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
};

// ============================================================
// Main App
// ============================================================
const COLLECTION_SIZE = 25;
const MIN_SCALE = 0.3;
const MAX_SCALE = 2.5;

export default function App() {
  const [photos, setPhotos] = useState<PhotoData[]>([]);
  const [layouts, setLayouts] = useState<Record<string, PhotoLayout>>({});
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [maxZ, setMaxZ] = useState(100);

  // Canvas pan + zoom
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);

  const [panDragging, setPanDragging] = useState(false);
  const panRef = useRef({ startX: 0, startY: 0, initX: 0, initY: 0 });
  const outerRef = useRef<HTMLDivElement>(null);

  // UI state
  const [showUpload, setShowUpload] = useState(false);
  const [heartMode, setHeartMode] = useState(false);
  const [savedLayouts, setSavedLayouts] = useState<Record<string, PhotoLayout>>({});
  const [activeCollection, setActiveCollection] = useState(0);
  const [lightboxPhoto, setLightboxPhoto] = useState<PhotoData | null>(null);

  // Batch delete state
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Pinch-to-zoom
  const pinchRef = useRef<{ dist: number } | null>(null);

  // Collections: chunk photos into groups of 25
  const totalCollections = Math.max(1, Math.ceil(photos.length / COLLECTION_SIZE));
  const collectionPhotos = photos.slice(
    activeCollection * COLLECTION_SIZE,
    (activeCollection + 1) * COLLECTION_SIZE
  );

  // Initial pan to center
  useEffect(() => {
    setPan({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  }, []);

  // Fetch photos from Cloudinary
  const fetchPhotos = useCallback(async () => {
    setLoading(true);
    setFetchError("");
    try {
      const res = await fetch(LIST_URL + `?t=${Date.now()}`);
      if (!res.ok) {
        if (res.status === 404) {
          setPhotos([]);
          setLoading(false);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      const resources: Array<{
        public_id: string;
        secure_url?: string;
        width: number;
        height: number;
        created_at?: string;
      }> = data.resources || [];

      resources.sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return ta - tb;
      });

      const storedLayouts = getStoredLayouts();
      const newLayouts: Record<string, PhotoLayout> = { ...storedLayouts };
      let zCounter = maxZ;

      const photosData: PhotoData[] = resources.map((r, idx) => {
        const id = r.public_id;
        if (!newLayouts[id]) {
          zCounter++;
          newLayouts[id] = generateLayout(id, idx, resources.length);
          newLayouts[id].zIndex = zCounter;
        }
        const url = r.secure_url || buildCloudinaryUrl(r.public_id);
        return {
          id,
          url,
          width: r.width || 800,
          height: r.height || 600,
          createdAt: r.created_at || "",
        };
      });

      setLayouts(newLayouts);
      saveLayouts(newLayouts);
      setMaxZ(zCounter);
      setPhotos(photosData);
    } catch (err: unknown) {
      setFetchError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  const handleUploadSuccess = (photo: PhotoData) => {
    setPhotos((prev) => {
      if (prev.find((p) => p.id === photo.id)) return prev;
      return [...prev, photo];
    });
    setLayouts((prev) => {
      if (prev[photo.id]) return prev;
      const newZ = maxZ + 1;
      setMaxZ(newZ);
      const newLayout: PhotoLayout = {
        id: photo.id,
        x: -pan.x / scale + window.innerWidth / 2 / scale + (Math.random() * 200 - 100),
        y: -pan.y / scale + window.innerHeight / 2 / scale + (Math.random() * 200 - 100),
        rot: Math.random() * 18 - 9,
        zIndex: newZ,
      };
      const updated = { ...prev, [photo.id]: newLayout };
      saveLayouts(updated);
      return updated;
    });
  };

  const handleDragEnd = (id: string, x: number, y: number) => {
    setLayouts((prev) => {
      const updated = { ...prev, [id]: { ...prev[id], x, y } };
      saveLayouts(updated);
      return updated;
    });
  };

  const handleActivate = (id: string) => {
    setActiveId(id);
    setMaxZ((z) => {
      const newZ = z + 1;
      setLayouts((prev) => {
        const updated = { ...prev, [id]: { ...prev[id], zIndex: newZ } };
        saveLayouts(updated);
        return updated;
      });
      return newZ;
    });
  };

  // Delete single photo from Cloudinary + state
  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteFromCloudinary(id);
    } catch (e) {
      console.warn("Cloudinary delete failed:", e);
    }
    setPhotos((prev) => prev.filter((p) => p.id !== id));
    setLayouts((prev) => {
      const updated = { ...prev };
      delete updated[id];
      saveLayouts(updated);
      return updated;
    });
    if (lightboxPhoto?.id === id) setLightboxPhoto(null);
  }, [lightboxPhoto]);

  // Batch delete
  const handleBatchDelete = async () => {
    setConfirmBatchDelete(false);
    setDeleting(true);
    setDeleteError("");
    const ids = Array.from(batchSelected);
    try {
      await Promise.all(ids.map((id) => deleteFromCloudinary(id).catch(() => {})));
    } catch (e) {
      console.warn("Batch delete error:", e);
    }
    setPhotos((prev) => prev.filter((p) => !batchSelected.has(p.id)));
    setLayouts((prev) => {
      const updated = { ...prev };
      ids.forEach((id) => delete updated[id]);
      saveLayouts(updated);
      return updated;
    });
    setBatchSelected(new Set());
    setBatchMode(false);
    setDeleting(false);
  };

  const toggleBatchSelect = (id: string) => {
    setBatchSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitBatchMode = () => {
    setBatchMode(false);
    setBatchSelected(new Set());
  };

  // Heart mode
  const toggleHeartMode = () => {
    if (!heartMode) {
      setSavedLayouts({ ...layouts });
      const pts = getHeartPoints(collectionPhotos.length);
      const spread = 38;
      const newLayouts = { ...layouts };
      collectionPhotos.forEach((photo, i) => {
        newLayouts[photo.id] = {
          ...newLayouts[photo.id],
          x: pts[i].x * spread,
          y: pts[i].y * spread,
          rot: 0,
        };
      });
      setLayouts(newLayouts);
      saveLayouts(newLayouts);
      setPan({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      setScale(1);
      setHeartMode(true);
    } else {
      const restored = { ...layouts, ...savedLayouts };
      setLayouts(restored);
      saveLayouts(restored);
      setHeartMode(false);
    }
  };

  // Canvas pointer events
  const isPanTarget = (target: EventTarget) => {
    const el = target as HTMLElement;
    return el === outerRef.current || el.dataset.canvasBg === "true";
  };

  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    if (!isPanTarget(e.target)) return;
    setActiveId(null);
    setShowUpload(false);
    setPanDragging(true);
    panRef.current = { startX: e.clientX, startY: e.clientY, initX: pan.x, initY: pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent) => {
    if (!panDragging) return;
    const dx = e.clientX - panRef.current.startX;
    const dy = e.clientY - panRef.current.startY;
    setPan({ x: panRef.current.initX + dx, y: panRef.current.initY + dy });
  };

  const handleCanvasPointerUp = () => setPanDragging(false);

  // Scroll-wheel zoom
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 0.92;
      setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * factor)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Pinch to zoom (touch)
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { dist: Math.sqrt(dx * dx + dy * dy) };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const ratio = dist / pinchRef.current.dist;
      setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * ratio)));
      pinchRef.current.dist = dist;
    }
  };

  const handleTouchEnd = () => { pinchRef.current = null; };

  const zoomIn = () => setScale((s) => Math.min(MAX_SCALE, +(s * 1.2).toFixed(3)));
  const zoomOut = () => setScale((s) => Math.max(MIN_SCALE, +(s / 1.2).toFixed(3)));
  const zoomReset = () => setScale(1);

  const batchSelectedInCollection = Array.from(batchSelected).filter((id) =>
    collectionPhotos.some((p) => p.id === id)
  ).length;

  return (
    <div
      ref={outerRef}
      style={{
        width: "100%",
        height: "100vh",
        overflow: "hidden",
        position: "relative",
        background: "#f0ebe0",
        backgroundImage: `
          linear-gradient(45deg,#e6e1d5 25%,transparent 25%,transparent 75%,#e6e1d5 75%,#e6e1d5),
          linear-gradient(45deg,#e6e1d5 25%,transparent 25%,transparent 75%,#e6e1d5 75%,#e6e1d5)
        `,
        backgroundPosition: "0 0,10px 10px",
        backgroundSize: "20px 20px",
        touchAction: "none",
        cursor: panDragging ? "grabbing" : "default",
        userSelect: "none",
        fontFamily: "'Segoe UI',Roboto,'Helvetica Neue',sans-serif",
      }}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handleCanvasPointerMove}
      onPointerUp={handleCanvasPointerUp}
      onPointerCancel={handleCanvasPointerUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Background watermark */}
      <div
        data-canvas-bg="true"
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          zIndex: 0,
        }}
      >
        <div style={{ textAlign: "center", color: "#a09080", opacity: 0.18, userSelect: "none" }}>
          <h1 style={{ fontSize: 42, fontWeight: 800, margin: "0 0 8px", letterSpacing: 4 }}>
            邵杰 · 若冰
          </h1>
          <p style={{ fontSize: 15, margin: 0 }}>拖动背景漫游 · 拖动照片移位 · 单击照片放大</p>
        </div>
      </div>

      {/* Virtual canvas layer */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          transform: `translate3d(${pan.x}px,${pan.y}px,0) scale(${scale})`,
          transformOrigin: "0 0",
          willChange: "transform",
          transition: panDragging ? "none" : "transform 0.06s ease-out",
        }}
      >
        {collectionPhotos.map((photo) => {
          const layout = layouts[photo.id];
          if (!layout) return null;
          return (
            <Polaroid
              key={photo.id}
              photo={photo}
              layout={layout}
              isActive={activeId === photo.id}
              isBatchSelected={batchSelected.has(photo.id)}
              isBatchMode={batchMode}
              scale={scale}
              onActivate={handleActivate}
              onDragEnd={handleDragEnd}
              onClickPhoto={batchMode ? () => toggleBatchSelect(photo.id) : setLightboxPhoto}
              onToggleBatchSelect={toggleBatchSelect}
            />
          );
        })}
      </div>

      {/* ========== UI OVERLAY ========== */}

      {/* Top bar */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "rgba(240,235,224,0.92)",
          backdropFilter: "blur(10px)",
          borderBottom: "1px solid rgba(180,160,130,0.3)",
          zIndex: 10000,
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        {/* Title */}
        <div>
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#5a4a3a", letterSpacing: 1 }}>
            🌸 邵杰-若冰的小天地
          </h1>
          <p style={{ margin: 0, fontSize: 11, color: "#9a8a7a" }}>
            {photos.length > 0
              ? `共 ${photos.length} 张 · ${totalCollections} 个合集`
              : "还没有照片"}
          </p>
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {/* Batch delete mode toggle */}
          {!batchMode ? (
            <button
              onClick={() => { setBatchMode(true); setShowUpload(false); }}
              title="批量删除"
              style={{
                padding: "7px 14px",
                borderRadius: 20,
                border: "1.5px solid rgba(229,62,62,0.4)",
                background: "rgba(255,255,255,0.75)",
                color: "#c0392b",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                transition: "all 0.2s",
              }}
            >
              ☑️ 批量删除
            </button>
          ) : (
            <>
              {/* Cancel batch */}
              <button
                onClick={exitBatchMode}
                style={{
                  padding: "7px 14px",
                  borderRadius: 20,
                  border: "1.5px solid #aaa",
                  background: "rgba(255,255,255,0.85)",
                  color: "#666",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                取消
              </button>
              {/* Select all in collection */}
              <button
                onClick={() => {
                  const allIds = collectionPhotos.map((p) => p.id);
                  const allSelected = allIds.every((id) => batchSelected.has(id));
                  setBatchSelected((prev) => {
                    const next = new Set(prev);
                    if (allSelected) allIds.forEach((id) => next.delete(id));
                    else allIds.forEach((id) => next.add(id));
                    return next;
                  });
                }}
                style={{
                  padding: "7px 14px",
                  borderRadius: 20,
                  border: "1.5px solid rgba(155,89,182,0.5)",
                  background: "rgba(255,255,255,0.85)",
                  color: "#9b59b6",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {collectionPhotos.every((p) => batchSelected.has(p.id)) ? "取消全选" : "全选"}
              </button>
              {/* Confirm delete batch */}
              <button
                onClick={() => { if (batchSelected.size > 0) setConfirmBatchDelete(true); }}
                disabled={batchSelected.size === 0 || deleting}
                style={{
                  padding: "7px 16px",
                  borderRadius: 20,
                  border: "none",
                  background: batchSelected.size === 0
                    ? "rgba(200,200,200,0.7)"
                    : "linear-gradient(135deg,#e53e3e,#c0392b)",
                  color: "white",
                  cursor: batchSelected.size === 0 ? "not-allowed" : "pointer",
                  fontSize: 13,
                  fontWeight: 700,
                  boxShadow: batchSelected.size > 0 ? "0 2px 10px rgba(229,62,62,0.4)" : "none",
                  transition: "all 0.2s",
                }}
              >
                {deleting ? "删除中..." : `🗑️ 删除已选 (${batchSelected.size})`}
              </button>
            </>
          )}

          {/* Heart toggle — only when not in batch mode */}
          {!batchMode && (
            <button
              onClick={toggleHeartMode}
              title={heartMode ? "恢复原排列" : "心形排列"}
              style={{
                padding: "7px 14px",
                borderRadius: 20,
                border: `1.5px solid ${heartMode ? "#e91e8c" : "rgba(180,160,130,0.5)"}`,
                background: heartMode
                  ? "linear-gradient(135deg,#e91e8c,#ff6b9d)"
                  : "rgba(255,255,255,0.75)",
                color: heartMode ? "white" : "#c0558a",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                transition: "all 0.25s",
              }}
            >
              {heartMode ? "💔 恢复" : "❤️ 心形"}
            </button>
          )}

          {/* Zoom controls */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "rgba(255,255,255,0.75)",
              borderRadius: 20,
              border: "1px solid rgba(180,160,130,0.4)",
              overflow: "hidden",
            }}
          >
            <button onClick={zoomOut} title="缩小" style={zoomBtnStyle}>−</button>
            <span
              onClick={zoomReset}
              title="重置缩放"
              style={{
                padding: "0 8px",
                fontSize: 12,
                color: "#7a6a5a",
                cursor: "pointer",
                userSelect: "none",
                minWidth: 44,
                textAlign: "center",
              }}
            >
              {Math.round(scale * 100)}%
            </span>
            <button onClick={zoomIn} title="放大" style={zoomBtnStyle}>+</button>
          </div>

          {/* Refresh */}
          <button
            onClick={fetchPhotos}
            title="刷新"
            style={{
              padding: "7px 14px",
              borderRadius: 20,
              border: "1px solid rgba(180,160,130,0.5)",
              background: "rgba(255,255,255,0.75)",
              cursor: "pointer",
              fontSize: 13,
              color: "#7a6a5a",
              fontWeight: 500,
            }}
          >
            🔄
          </button>

          {/* Upload */}
          {!batchMode && (
            <button
              onClick={() => setShowUpload((v) => !v)}
              style={{
                padding: "7px 16px",
                borderRadius: 20,
                border: "none",
                background: "linear-gradient(135deg,#9b59b6,#e91e8c)",
                color: "white",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                boxShadow: "0 2px 8px rgba(155,89,182,0.4)",
              }}
            >
              + 上传照片
            </button>
          )}
        </div>
      </div>

      {/* Batch mode banner */}
      {batchMode && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: 64,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(229,62,62,0.92)",
            backdropFilter: "blur(8px)",
            borderRadius: 28,
            padding: "8px 22px",
            zIndex: 9999,
            color: "white",
            fontSize: 13,
            fontWeight: 600,
            boxShadow: "0 4px 18px rgba(229,62,62,0.4)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>☑️ 批量选择模式</span>
          <span style={{ opacity: 0.85, fontWeight: 400 }}>
            — 点击照片选择，已选 {batchSelected.size} 张
            {batchSelectedInCollection > 0 && batchSelected.size !== batchSelectedInCollection
              ? `（本页 ${batchSelectedInCollection} 张）`
              : ""}
          </span>
        </div>
      )}

      {/* Collection tabs */}
      {totalCollections > 1 && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: batchMode ? 110 : 64,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            gap: 6,
            zIndex: 9998,
            background: "rgba(240,235,224,0.9)",
            backdropFilter: "blur(8px)",
            borderRadius: 24,
            padding: "5px 10px",
            border: "1px solid rgba(180,160,130,0.3)",
            boxShadow: "0 2px 12px rgba(0,0,0,0.1)",
          }}
        >
          {Array.from({ length: totalCollections }).map((_, i) => {
            const start = i * COLLECTION_SIZE + 1;
            const end = Math.min((i + 1) * COLLECTION_SIZE, photos.length);
            const isAct = i === activeCollection;
            return (
              <button
                key={i}
                onClick={() => {
                  setActiveCollection(i);
                  setHeartMode(false);
                  setPan({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
                }}
                style={{
                  padding: "5px 14px",
                  borderRadius: 18,
                  border: "none",
                  background: isAct
                    ? "linear-gradient(135deg,#9b59b6,#e91e8c)"
                    : "rgba(255,255,255,0.6)",
                  color: isAct ? "white" : "#7a6a5a",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: isAct ? 700 : 400,
                  transition: "all 0.2s",
                  whiteSpace: "nowrap",
                }}
              >
                合集 {i + 1}
                <span style={{ opacity: 0.75, marginLeft: 4, fontSize: 10 }}>
                  ({start}-{end})
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Upload panel */}
      {showUpload && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{ position: "fixed", top: 68, right: 16, zIndex: 10001 }}
        >
          <UploadPanel onUploadSuccess={handleUploadSuccess} onClose={() => setShowUpload(false)} />
        </div>
      )}

      {/* Delete error toast */}
      {deleteError && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setDeleteError("")}
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#fff3cd",
            border: "1px solid #ffc107",
            borderRadius: 12,
            padding: "12px 24px",
            zIndex: 10002,
            fontSize: 13,
            color: "#856404",
            cursor: "pointer",
            boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
          }}
        >
          ⚠️ {deleteError}（点击关闭）
        </div>
      )}

      {/* Loading overlay */}
      {loading && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(240,235,224,0.88)",
            zIndex: 20000,
          }}
        >
          <div style={{ textAlign: "center", color: "#7a6a5a" }}>
            <div
              style={{
                width: 52,
                height: 52,
                border: "4px solid #d4c5b0",
                borderTopColor: "#9b59b6",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
                margin: "0 auto 16px",
              }}
            />
            <p style={{ margin: 0, fontSize: 16 }}>正在加载照片...</p>
          </div>
        </div>
      )}

      {/* Fetch error */}
      {fetchError && !loading && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            bottom: 20,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#fff3cd",
            border: "1px solid #ffc107",
            borderRadius: 12,
            padding: "14px 22px",
            zIndex: 10002,
            maxWidth: 360,
            textAlign: "center",
            fontSize: 13,
            color: "#856404",
          }}
        >
          <p style={{ margin: "0 0 4px", fontWeight: 600 }}>⚠️ 加载出现问题</p>
          <p style={{ margin: "0 0 8px", fontSize: 12 }}>{fetchError}</p>
          <p style={{ margin: "0 0 10px", fontSize: 11, color: "#a07820" }}>
            请在 Cloudinary 控制台：<br />
            1. 创建名为 <b>memory_board</b> 的无签名上传预设<br />
            2. Settings → Security → 取消勾选 "Resource list"
          </p>
          <button
            onClick={fetchPhotos}
            style={{
              padding: "7px 18px",
              background: "#ffc107",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            重试
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && photos.length === 0 && !fetchError && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(255,255,255,0.92)",
            border: "1px solid rgba(180,160,130,0.4)",
            borderRadius: 14,
            padding: "16px 28px",
            zIndex: 10000,
            textAlign: "center",
            fontSize: 13,
            color: "#7a6a5a",
            pointerEvents: "none",
          }}
        >
          <p style={{ margin: 0 }}>✨ 点击右上角「+ 上传照片」，开始添加你们的回忆</p>
        </div>
      )}

      {/* Bottom hint */}
      {!loading && photos.length > 0 && !batchMode && (
        <div
          style={{
            position: "fixed",
            bottom: 10,
            right: 14,
            fontSize: 11,
            color: "#b0a090",
            pointerEvents: "none",
          }}
        >
          拖动背景漫游 · 拖动照片移位 · 滚轮/捏合缩放 · 单击放大
        </div>
      )}

      {/* Lightbox */}
      {lightboxPhoto && (
        <Lightbox
          photo={lightboxPhoto}
          onClose={() => setLightboxPhoto(null)}
          onDelete={handleDelete}
        />
      )}

      {/* Batch confirm dialog */}
      {confirmBatchDelete && (
        <ConfirmDialog
          message={`确定要删除这 ${batchSelected.size} 张照片吗？`}
          subMessage="所有选中的照片将永久从云端删除，无法恢复。"
          confirmLabel={`删除 ${batchSelected.size} 张`}
          onConfirm={handleBatchDelete}
          onCancel={() => setConfirmBatchDelete(false)}
        />
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}

const zoomBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: 16,
  padding: "5px 10px",
  color: "#7a6a5a",
  fontWeight: 700,
  lineHeight: 1,
};
