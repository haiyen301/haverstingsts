"use client";

import { useMemo, useRef, useState } from "react";
import { Calendar, MapPin, Pencil, Users } from "lucide-react";

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
import {
  isPlaceholderAssigneeAvatarUrl,
  resolveStaffAvatarImageUrl,
} from "../lib/staffAvatarUrl";
import { translateProjectType } from "../lib/projectTypeDisplay";
import { cn } from "@/lib/utils";

/** Harvesting Portal `Progress` parity: track `bg-secondary`, fill `bg-primary`. */
function HarvestProgress({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-full bg-secondary",
        className,
      )}
      role="progressbar"
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-primary transition-all duration-500"
        style={{ width: `${v}%` }}
      />
    </div>
  );
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
    getProjectTypeLabel:
      options?.getProjectTypeLabel ??
      ((raw) =>
        translateProjectType(String(raw ?? ""), (k) => tBase(`ProjectForm.${k}`))),
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
    const assigneeId = String(
      (serverRow as Record<string, unknown> | undefined)?.pic ?? "",
    ).trim();
    if (assigneeId) {
      const staffRow = (staffs as unknown[]).find((s) => {
        if (!s || typeof s !== "object") return false;
        return String((s as Record<string, unknown>).id ?? "").trim() === assigneeId;
      }) as Record<string, unknown> | undefined;
      const fromStaff = resolveStaffAvatarImageUrl(staffRow?.image);
      if (fromStaff) return fromStaff;
    }
    const avatarFromCard = String(data?.assignee?.avatar ?? "").trim();
    if (avatarFromCard && !isPlaceholderAssigneeAvatarUrl(avatarFromCard)) {
      return avatarFromCard;
    }
    return DEFAULT_ASSIGNEE_AVATAR;
  }, [data?.assignee?.avatar, serverRow, staffs]);
  if (!data) return null;
  const rowId = String(serverRow?.row_id ?? serverRow?.id ?? "").trim() || undefined;
  const tableId = String(serverRow?.table_id ?? "").trim() || undefined;

  const cfg = STATUS_CONFIG[data.status];
  /** From buildProjectData: average of per-line `min(1, delivered/required)`; delivered only with valid delivery date. */
  const clampedProgress = Math.max(0, Math.min(100, data.progress));
  const typeTag = String(data.tags[0] ?? "").trim();
  const extraTags = data.tags.slice(1).filter(Boolean);
  const estimateLabel = String(data.endDate || data.estimatedStartDate || "").trim();
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
  return (
    <div className="relative h-full">
      {canEdit ? (
        <button
          type="button"
          data-no-card-click="true"
          className="absolute top-3 right-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card/90 text-muted-foreground backdrop-blur transition-colors hover:border-primary/40 hover:text-primary"
          aria-label={tProject("projectDetails")}
          title={tProject("projectDetails")}
          onClick={(e) => {
            e.stopPropagation();
            handleEdit();
          }}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      ) : null}

      <div
        className={cn(
          "relative h-full overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm transition-shadow",
          "hover:shadow-md hover:border-primary/30",
        )}
      >
        <div className="p-3 space-y-4">
          {/* Top row — only this block opens project detail */}
          <div
            className={cn(
              "group/detail flex items-start gap-3 rounded-md pr-10",
              canEdit &&
                "cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
            )}
            role={canEdit ? "button" : undefined}
            tabIndex={canEdit ? 0 : undefined}
            aria-label={canEdit ? `${tProject("projectDetails")}: ${data.name}` : undefined}
            onClick={canEdit ? handleEdit : undefined}
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
          >
            {/* <div className="relative shrink-0" data-no-card-click="true">
              <img
                src={displayedImage}
                alt=""
                className="h-14 w-14 rounded-md border border-border object-cover"
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
            </div> */}
            <div className="min-w-0 flex-1">
              <div className="gap-2">
              {typeTag ? (
                <div className="flex justify-end mb-3">
                  <span className="shrink-0 rounded-md border border-border px-2 py-0.5 text-xs font-normal text-foreground">
                      {typeTag}
                    </span>
                  </div>
                ) : null}
                <div className="min-w-0">
                  <h3
                    className="truncate font-heading font-semibold text-foreground transition-colors group-hover/detail:text-primary"
                    title={data.name}
                  >
                    {data.name}
                  </h3>
                  <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <Users className="h-3 w-3 shrink-0" />
                    <img
                      src={resolvedAssigneeAvatar}
                      alt=""
                      className="h-4 w-4 shrink-0 rounded-full border border-border object-cover"
                      onError={(e) => {
                        e.currentTarget.src = DEFAULT_ASSIGNEE_AVATAR;
                      }}
                    />
                    <span className="truncate">{data.assignee.name}</span>
                  </p>
                  {data.subtitle ? (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground" title={data.subtitle}>
                      {data.subtitle}
                    </p>
                  ) : null}
                </div>
               
              </div>
            </div>
          </div>

          {/* Country, estimate, status */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            {countryLabel ? (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3 shrink-0" />
                {countryLabel}
              </span>
            ) : null}
            {estimateLabel ? (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3 shrink-0" />
                Est. {estimateLabel}
              </span>
            ) : null}
            <span
              className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium"
              style={{
                borderColor: cfg.border,
                color: cfg.text,
                backgroundColor: "hsl(var(--card))",
              }}
            >
              {/* <img
                src={cfg.icon}
                alt=""
                width={cfg.iconSize}
                height={cfg.iconSize}
                className="shrink-0"
              /> */}
              {data.status}
            </span>
          </div>

          {/* Grass requirements + per-line progress */}
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {tBase("ProjectForm.grassRequirements")}
            </p>
            {data.items.length === 0 ? (
              <p className="text-xs text-muted-foreground">{tBase("ProjectDetail.noGrasses")}</p>
            ) : (
              data.items.map((item, idx) => {
                const req = Math.max(0, item.required);
                const del = Math.max(0, item.delivered);
                const linePct =
                  req > 0 ? Math.round((Math.min(del, req) / req) * 100) : 0;
                const uom = String(item.uom ?? "").trim();
                const uomSuffix = uom ? `\u00a0${uom}` : "";
                return (
                  <div key={idx} className="text-xs">
                    <div className="mb-1 flex justify-between gap-2">
                      <span className="min-w-0 truncate font-medium text-foreground">{item.name}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {del.toLocaleString()}
                        {" / "}
                        {req.toLocaleString()}
                        {uomSuffix} — {linePct}%
                      </span>
                    </div>
                    <HarvestProgress value={linePct} className="h-1.5" />
                  </div>
                );
              })
            )}
          </div>

          {/* Overall progress */}
          <div className="border-t border-border pt-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-foreground">{tProject("cardOverallProgress")}</span>
              <span
                className={cn(
                  "font-bold",
                  clampedProgress === 100 ? "text-primary" : "text-accent",
                )}
              >
                {Math.round(clampedProgress)}%
              </span>
            </div>
            <HarvestProgress value={clampedProgress} className="mt-1.5 h-2" />
          </div>

          {extraTags.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {extraTags.map((tag, idx) => (
                <span
                  key={`${tag}-${idx}`}
                  className="truncate rounded-md border border-border px-2 py-0.5 text-xs text-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
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
