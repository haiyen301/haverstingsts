"use client";

import { useMemo, useRef, useState } from "react";

import type { BuildProjectDataOptions } from "@/entities/projects";
import { uploadMondayProjectImageFromCard } from "@/entities/projects";
import {
  buildProjectDataFromServerRow,
  resolveReactHarvestingImageUrl,
} from "../lib/buildProjectCardData";
import {
  extractProjectImageFileNamesFromRow,
  findFirstFileNameFromAny,
} from "../lib/projectImageHelpers";
import type { ProjectListItemProps } from "../model/projectListProps";
import { countryNameByIdFromRows } from "@/shared/lib/harvestReferenceData";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";
import { getStsDomainUrl, STS_PUBLIC_PATHS } from "@/shared/config/stsUrls";

function getProgressColor(progress: number) {
  void progress;
  return "#268626";
}

function getProgressBg(progress: number) {
  void progress;
  return "#9D9D9D";
}

const STATUS_CONFIG = {
  Ongoing: {
    border: "#CFE93E",
    bg: "#FFFAFA",
    text: "#000000",
    icon: "/status-icons/ongoing.svg",
    iconSize: 10,
  },
  Future: {
    border: "#349EF5",
    bg: "#FFFAFA",
    text: "#000000",
    icon: "/status-icons/future.svg",
    iconSize: 15,
  },
  Done: {
    border: "#9D9D9D",
    bg: "#FFFAFA",
    text: "#000000",
    icon: "/status-icons/done.svg",
    iconSize: 10,
  },
  Warning: {
    border: "#FF0000",
    bg: "#FFFAFA",
    text: "#FF0000",
    icon: "/status-icons/warning.svg",
    iconSize: 10,
  },
} as const;

const DEFAULT_ASSIGNEE_AVATAR =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='32' fill='%23E5E7EB'/%3E%3Ccircle cx='32' cy='24' r='12' fill='%239CA3AF'/%3E%3Cpath d='M12 56c2.8-11.2 11-16 20-16s17.2 4.8 20 16' fill='%239CA3AF'/%3E%3C/svg%3E";

function buildProfileAvatarUrl(fileNameOrPath: string): string {
  const value = String(fileNameOrPath ?? "").trim();
  if (!value) return "";
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("//")) return `https:${value}`;
  const root = getStsDomainUrl().replace(/\/$/, "");
  if (!root) return value;
  if (value.startsWith("/")) {
    if (value.startsWith("/files/")) return `${root}${value}`;
    return `${root}${STS_PUBLIC_PATHS.profileImages}/${value.replace(/^\/+/, "")}`;
  }
  if (value.includes("/")) {
    if (value.startsWith("files/")) return `${root}/${value}`;
    if (value.startsWith("profile_images/")) {
      return `${root}/${STS_PUBLIC_PATHS.files}/${value}`;
    }
    return `${root}/${value}`;
  }
  return `${root}${STS_PUBLIC_PATHS.profileImages}/${value}`;
}

/** Mirrors Flutter parse of staff image payload to extract `file_name`. */
function parseStaffAvatarFromRaw(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (
    text.startsWith("http://") ||
    text.startsWith("https://") ||
    text.startsWith("//")
  ) {
    return buildProfileAvatarUrl(text);
  }
  const phpFileName =
    text.match(/["']?file_name["']?\s*[:=]\s*["']([^"']+)["']/i)?.[1] ??
    text.match(/s:\d+:"file_name";s:\d+:"([^"]+)"/i)?.[1];
  if (phpFileName) return buildProfileAvatarUrl(phpFileName);
  if (text.includes("profile_images")) return buildProfileAvatarUrl(text);
  return "";
}

export function ProjectListItem({
  project,
  serverRow,
  options,
  getProjectTitleById,
  getCountryNameById,
  getUserNameById,
  getProductNameById,
  getUserAvatarById,
  onEditProject,
}: ProjectListItemProps) {
  const tBase = useAppTranslations();
  const tProject = (key: string) => tBase(`Projects.${key}`);
  const tCommon = (key: string) => tBase(`Common.${key}`);
  const mergedOptions: BuildProjectDataOptions = {
    ...options,
    getProjectTitleById: getProjectTitleById ?? options?.getProjectTitleById,
    getCountryNameById: getCountryNameById ?? options?.getCountryNameById,
    getUserNameById: getUserNameById ?? options?.getUserNameById,
    getProductNameById: getProductNameById ?? options?.getProductNameById,
    getUserAvatarById: getUserAvatarById ?? options?.getUserAvatarById,
  };
  const data = project ?? (serverRow ? buildProjectDataFromServerRow(serverRow, mergedOptions) : null);
  const countries = useHarvestingDataStore((s) => s.countries);
  const staffs = useHarvestingDataStore((s) => s.staffs);
  const countryLabel = useMemo(() => {
    const fromStore = countryNameByIdFromRows(countries, data?.country_id);
    if (fromStore) return fromStore;
    return String(data?.country_name ?? "").trim();
  }, [countries, data?.country_id, data?.country_name]);
  const resolvedAssigneeAvatar = useMemo(() => {
    const avatarFromCard = String(data?.assignee?.avatar ?? "").trim();
    if (
      avatarFromCard &&
      !avatarFromCard.includes("i.pravatar.cc") &&
      !avatarFromCard.includes("placehold.co")
    ) {
      return avatarFromCard;
    }
    const assigneeId = String(
      (serverRow as Record<string, unknown> | undefined)?.pic ?? "",
    ).trim();
    if (!assigneeId) return avatarFromCard || DEFAULT_ASSIGNEE_AVATAR;
    const staffRow = (staffs as unknown[]).find((s) => {
      if (!s || typeof s !== "object") return false;
      return String((s as Record<string, unknown>).id ?? "").trim() === assigneeId;
    }) as Record<string, unknown> | undefined;
    const parsed = parseStaffAvatarFromRaw(staffRow?.image);
    return parsed || avatarFromCard || DEFAULT_ASSIGNEE_AVATAR;
  }, [data?.assignee?.avatar, serverRow, staffs]);
  if (!data) return null;
  const rowId = String(serverRow?.row_id ?? serverRow?.id ?? "").trim() || undefined;
  const tableId = String(serverRow?.table_id ?? "").trim() || undefined;

  const cfg = STATUS_CONFIG[data.status];
  const pColor = getProgressColor(data.progress);
  const pBg = getProgressBg(data.progress);
  const clampedProgress = Math.max(0, Math.min(100, data.progress));
  const canEdit = Boolean(serverRow && onEditProject);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [pendingImagePreviewUrl, setPendingImagePreviewUrl] = useState<string>("");
  const [showImageModal, setShowImageModal] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [liveImageUrl, setLiveImageUrl] = useState<string>("");

  const displayedImage = liveImageUrl || data.image || "https://placehold.co/80x80?text=IMG";

  const openImagePicker = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (imageUploading) return;
    fileInputRef.current?.click();
  };
  const onImageFileChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    e.stopPropagation();
    const file = e.target.files?.[0];
    if (!file) return;
    const nextPreview = URL.createObjectURL(file);
    if (pendingImagePreviewUrl) URL.revokeObjectURL(pendingImagePreviewUrl);
    setPendingImageFile(file);
    setPendingImagePreviewUrl(nextPreview);
    setShowImageModal(true);
    e.currentTarget.value = "";
  };
  const closeImageModal = () => {
    if (imageUploading) return;
    setShowImageModal(false);
    setPendingImageFile(null);
    if (pendingImagePreviewUrl) URL.revokeObjectURL(pendingImagePreviewUrl);
    setPendingImagePreviewUrl("");
  };
  const saveProjectImage = async () => {
    if (!pendingImageFile || !serverRow) return;
    const rowIdForUpload = String(serverRow.row_id ?? serverRow.id ?? "").trim();
    const tableIdForUpload = String(serverRow.table_id ?? "").trim();
    const projectIdForUpload = String(serverRow.project_id ?? "").trim();
    if (!rowIdForUpload || !tableIdForUpload || !projectIdForUpload) return;
    try {
      setImageUploading(true);
      const response = await uploadMondayProjectImageFromCard({
        rowId: rowIdForUpload,
        tableId: tableIdForUpload,
        projectId: projectIdForUpload,
        file: pendingImageFile,
        existingFilesToRemove: extractProjectImageFileNamesFromRow(
          serverRow as unknown as Record<string, unknown>,
        ),
        rowData: { ...(serverRow as Record<string, unknown>) },
      });
      const savedFileName = findFirstFileNameFromAny(response);
      if (savedFileName) {
        setLiveImageUrl(resolveReactHarvestingImageUrl(savedFileName));
      } else if (pendingImagePreviewUrl) {
        setLiveImageUrl(pendingImagePreviewUrl);
      }
      setShowImageModal(false);
      setPendingImageFile(null);
      setPendingImagePreviewUrl("");
    } finally {
      setImageUploading(false);
    }
  };

  const handleEdit = () => {
    if (!serverRow || !onEditProject) return;
    onEditProject({
      rowId,
      tableId,
      rowData: { ...(serverRow as Record<string, unknown>) },
    });
  };
  const handleCardClick: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (!canEdit) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("[data-no-card-click='true']")) return;
    handleEdit();
  };

  return (
    <div
      className="relative overflow-hidden bg-white rounded-2xl shadow-sm hover:shadow-lg transition-all duration-200 flex flex-col"
      role={canEdit ? "button" : undefined}
      tabIndex={canEdit ? 0 : undefined}
      onClick={canEdit ? handleCardClick : undefined}
      onKeyDown={
        canEdit
          ? (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleEdit();
            }
          }
          : undefined
      }
      style={{ border: "1px solid #e5e7eb", borderLeft: `4px solid ${cfg.border}` }}
    >
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-start gap-4">
      
            <img
              src={displayedImage}
              alt={data.name}
              className="rounded-full object-cover flex-shrink-0"
              style={{ width: 80, height: 80, border: "2px solid #e5e7eb" }}
              data-no-card-click="true"
              onClick={openImagePicker}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              data-no-card-click="true"
              onChange={onImageFileChange}
            />
       
          <div className="w-[calc(100%-80px)] p-3 pt-0">
            <div className="flex justify-between pb-2">
              <div className="left-side">

                {data.endDate ? (
                  <span
                    className="rounded-full px-3 py-0.5"
                    style={{
                      fontSize: "12px",
                      fontWeight: 500,
                      background: data.status === "Warning" ? "#FF0000" : "#f0fdf4",
                      color: data.status === "Warning" ? "#FFFFFF" : "#15803d",
                      border: "1px solid #bbf7d0",
                    }}
                  >
                    {data.endDate}
                  </span>
                ) : null}
                {countryLabel ? (
                  <span
                    className="rounded-full px-3 py-0.5"
                    style={{
                      fontSize: "12px",
                      fontWeight: 500,
                      background: "#f0fdf4",
                      color: "#15803d",
                      border: "1px solid #bbf7d0",
                    }}
                  >
                    {countryLabel}
                  </span>
                ) : null}
              </div>
              <div className="right-side">
                <div
                  className="flex relative w-[100px] h-[30px] items-center gap-1.5 rounded-full px-2 py-1 flex-shrink-0"
                  style={{ background: "#f9fafb", border: "1px solid #e5e7eb" }}
                >
                  <img
                    src={resolvedAssigneeAvatar}
                    alt={data.assignee.name}
                    className="w-[30px] h-[30px] rounded-full object-cover absolute top-0 right-[0px]"
                    onError={(e) => {
                      e.currentTarget.src = DEFAULT_ASSIGNEE_AVATAR;
                    }}
                  />
                  <span style={{ fontSize: "12px", fontWeight: 500, color: "#374151" }}>
                    {data.assignee.name}
                  </span>
                </div>
              </div>
            </div>
            <div className="details">
              <h2
                className="text-gray-900 truncate"
                style={{ fontSize: "17px", fontWeight: 700, lineHeight: 1.2 }}
                title={data.name}
              >
                {data.name}
              </h2>
              <p
                className="text-gray-500 truncate mt-0.5"
                style={{ fontSize: "13px" }}
                title={data.subtitle}
              >
                {data.subtitle}
              </p>
            </div>
          </div>



        </div>
      </div>

      <div className="px-5 pb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span style={{ fontSize: "12px", color: "#6b7280" }}>{tBase("ProjectDetail.progress")}</span>
          <span style={{ fontSize: "13px", fontWeight: 700, color: pColor }}>
            {Math.round(clampedProgress)}%
          </span>
        </div>
        <div className="rounded-[4px] overflow-hidden" style={{ height: 6, background: pBg }}>
          <div
            className="h-full rounded-[4px] transition-all duration-500"
            style={{
              width: clampedProgress > 0 ? `${clampedProgress}%` : 0,
              background: pColor,
            }}
          />
        </div>
      </div>

      <div style={{ height: 1, background: "#f3f4f6", margin: "0 20px" }} />

      <div className="px-5 py-3">
        <div
          className="grid pb-1.5 mb-1"
          style={{
            gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
            borderBottom: "1px solid #f3f4f6",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              color: "#9ca3af",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {tBase("ProjectDetail.grassType")}
          </div>
          <div
            className="text-center"
            style={{
              fontSize: "11px",
              color: "#16a34a",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {tBase("ProjectDetail.required")}
          </div>
          <div
            className="text-center"
            style={{
              fontSize: "11px",
              color: "#16a34a",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {tBase("ProjectDetail.delivered")}
          </div>
          <div
            className="text-center"
            style={{
              fontSize: "11px",
              color: "#dc2626",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {tBase("ProjectDetail.remaining")}
          </div>
          <div
            className="text-center"
            style={{
              fontSize: "11px",
              color: "#dc2626",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            %
          </div>
        </div>

        {data.items.map((item, idx) => (
          <div
            key={idx}
            className="grid py-1.5"
            style={{
              gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
              borderBottom: idx < data.items.length - 1 ? "1px solid #f9fafb" : "none",
            }}
          >
            <div className="text-gray-800 truncate pr-2" style={{ fontSize: "13px", fontWeight: 600 }}>
              {item.name}
            </div>
            <div className="text-center text-gray-600" style={{ fontSize: "13px" }}>
              {item.required.toLocaleString()}
            </div>
            <div className="text-center text-gray-600" style={{ fontSize: "13px" }}>
              {item.delivered.toLocaleString()}
            </div>
            <div
              className="text-center"
              style={{
                fontSize: "13px",
                fontWeight: item.remaining > 0 ? 700 : 400,
                color: item.remaining > 0 ? "#dc2626" : "#6b7280",
              }}
            >
              {item.remaining.toLocaleString()}
            </div>
            <div
              className="text-center"
              style={{
                fontSize: "13px",
                fontWeight: item.percentage > 0 ? 700 : 400,
                color: item.percentage > 0 ? "#dc2626" : "#6b7280",
              }}
            >
              {item.percentage}%
            </div>
          </div>
        ))}
      </div>

      <div style={{ height: 1, background: "#f3f4f6", margin: "0 20px" }} />

      <div className="px-5 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {data.tags.map((tag, idx) => (
            <span
              key={idx}
              className="rounded-full truncate"
              style={{
                fontSize: "12px",
                fontWeight: 500,
                color: "#374151",
                background: "#f9fafb",
                border: "1px solid #e5e7eb",
                padding: "2px 10px",
                whiteSpace: "nowrap",
              }}
            >
              {tag}
            </span>
          ))}
        </div>

        <div
          className="absolute bottom-[-1px] right-[-1px] flex items-center gap-1.5 rounded-tl-[50px] px-4 py-1.5 flex-shrink-0"
          style={{
            border: `1.5px solid ${cfg.border}`,
            background: cfg.bg,
          }}
        >
          <img
            src={cfg.icon}
            alt={`${data.status} icon`}
            style={{ width: cfg.iconSize, height: cfg.iconSize, flexShrink: 0 }}
          />
          <span style={{ fontSize: "13px", fontWeight: 600, color: cfg.text }}>
            {data.status}
          </span>
        </div>
      </div>
      {showImageModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={closeImageModal}
        >
          <div
            className="w-full max-w-xl rounded-xl bg-white p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-3 text-sm font-semibold text-gray-800">{tProject("imagePreviewTitle")}</p>
            <div className="mb-4 overflow-hidden rounded-lg border border-gray-200">
              <img
                src={pendingImagePreviewUrl || displayedImage}
                alt="Preview"
                className="h-[280px] w-full object-cover"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700"
                onClick={closeImageModal}
                disabled={imageUploading}
              >
                {tCommon("cancel")}
              </button>
              <button
                type="button"
                className="rounded-md bg-[#1F7A4C] px-4 py-2 text-sm text-white disabled:opacity-60"
                onClick={saveProjectImage}
                disabled={!pendingImageFile || imageUploading}
              >
                {imageUploading ? tBase("ProjectForm.saving") : tCommon("save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
