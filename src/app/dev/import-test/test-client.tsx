"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";

import RequireAuth from "@/features/auth/RequireAuth";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import {
  fetchMondayProjectRowsFromServer,
  updateMondayProjectParentItem,
} from "@/entities/projects";
import { submitFlutterHarvest } from "@/features/harvesting/api/flutterHarvestSubmit";
import { stsProxyGetHarvestingIndex, stsProxyPostJson } from "@/shared/api/stsProxyClient";
import { STS_API_PATHS } from "@/shared/api/stsApiPaths";

type LogLevel = "info" | "success" | "error";
type LogItem = {
  id: string;
  level: LogLevel;
  message: string;
};

function toStr(v: unknown): string {
  return String(v ?? "").trim();
}

function randomMarker(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export function DevImportTestClient() {
  const router = useRouter();
  const user = useAuthUserStore((s) => s.user);
  const projects = useHarvestingDataStore((s) => s.projects);
  const farms = useHarvestingDataStore((s) => s.farms);
  const products = useHarvestingDataStore((s) => s.products);
  const activeCountries = useHarvestingDataStore((s) => s.activeCountries);
  const staffs = useHarvestingDataStore((s) => s.staffs);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );

  const [busyKey, setBusyKey] = useState<
    "" | "project-import" | "project-manual" | "harvest-import" | "harvest-manual" | "excel"
  >("");
  const [logs, setLogs] = useState<LogItem[]>([]);

  const firstFarmId = useMemo(() => toStr((farms[0] as Record<string, unknown> | undefined)?.id), [farms]);
  const firstProductId = useMemo(
    () => toStr((products[0] as Record<string, unknown> | undefined)?.id),
    [products],
  );
  const firstCountryId = useMemo(
    () => toStr((activeCountries[0] as Record<string, unknown> | undefined)?.id),
    [activeCountries],
  );
  const firstStaffId = useMemo(
    () => toStr((staffs[0] as Record<string, unknown> | undefined)?.id),
    [staffs],
  );

  const appendLog = (level: LogLevel, message: string) => {
    setLogs((prev) => [
      {
        id: `${Date.now()}-${Math.random()}`,
        level,
        message,
      },
      ...prev,
    ]);
  };

  const ensureRefs = async () => {
    await fetchAllHarvestingReferenceData(true);
  };

  const runProjectImportValueTest = async () => {
    setBusyKey("project-import");
    try {
      await ensureRefs();
      const tableRes = await fetchMondayProjectRowsFromServer({ page: 1, perPage: 1 });
      const tableId = toStr(tableRes.rows[0]?.table_id);
      if (!tableId) throw new Error("Cannot resolve table_id for project test.");
      if (!firstProductId) throw new Error("No product available for test data.");

      const marker = randomMarker("dev-project");
      const payload: Record<string, unknown> = {
        id: globalThis.crypto?.randomUUID?.() ?? marker,
        table_id: tableId,
        client_source: "nextjs",
        data: {
          project_name: marker,
          alias_title: `${marker}-club`,
          company_name: "DEV TEST COMPANY",
          golf_course_architect: "DEV Architect",
          estimate_start_date: "2026-01-10",
          start_date: "2026-01-15",
          deadline: "2026-12-15",
          country_id: firstCountryId,
          pic: firstStaffId,
          project_type: "Golf Course - New",
          no_of_holes: "18",
          key_areas: "Tees,Roughs,Fairways,Greens",
          quantity_required_sprig_sod: [
            {
              id: globalThis.crypto?.randomUUID?.() ?? `${marker}-g1`,
              product_id: firstProductId,
              quantity: "1000",
              uom: "Kg",
            },
          ],
        },
      };

      const saveResponse = await updateMondayProjectParentItem(payload);
      const saveResponseRec = saveResponse as Record<string, unknown>;
      const saveResponseProject =
        saveResponseRec.project && typeof saveResponseRec.project === "object"
          ? (saveResponseRec.project as Record<string, unknown>)
          : null;
      const projectId = toStr(saveResponseProject?.id);
      if (!projectId) {
        appendLog("error", "Project created but missing project.id in response.");
        return;
      }
      const dynamicRows = await stsProxyPostJson<unknown[]>(
        STS_API_PATHS.mondayFindDynamicByField,
        { field_name: "project_id", field_value: projectId },
      );
      const rows = Array.isArray(dynamicRows) ? dynamicRows : [];
      const createdBy = toStr((rows[0] as Record<string, unknown> | undefined)?.created_by);
      const expectedUid = toStr(user?.id);
      if (expectedUid && createdBy && createdBy !== expectedUid) {
        appendLog(
          "error",
          `Project import value test failed: created_by=${createdBy}, expected=${expectedUid}.`,
        );
        return;
      }
      appendLog(
        "success",
        `Project import value test passed (project_id=${projectId}, created_by=${createdBy || "n/a"}).`,
      );
    } catch (e) {
      appendLog("error", e instanceof Error ? e.message : "Project import value test failed.");
    } finally {
      setBusyKey("");
    }
  };

  const runProjectManualValueTest = async () => {
    setBusyKey("project-manual");
    try {
      await ensureRefs();
      const tableRes = await fetchMondayProjectRowsFromServer({ page: 1, perPage: 1 });
      const tableId = toStr(tableRes.rows[0]?.table_id);
      if (!tableId) throw new Error("Cannot resolve table_id for project manual test.");
      if (!firstProductId) throw new Error("No product available for test data.");

      const marker = randomMarker("dev-project-manual");
      const payload: Record<string, unknown> = {
        id: globalThis.crypto?.randomUUID?.() ?? marker,
        table_id: tableId,
        // Manual create flow in web app also sends client_source=nextjs.
        client_source: "nextjs",
        data: {
          project_name: marker,
          alias_title: `${marker}-club`,
          company_name: "DEV MANUAL COMPANY",
          golf_course_architect: "DEV Manual Architect",
          estimate_start_date: "2026-02-10",
          start_date: "2026-02-15",
          deadline: "2026-11-15",
          country_id: firstCountryId,
          pic: firstStaffId,
          project_type: "Golf Course - Renovation",
          no_of_holes: "9",
          key_areas: "Tees,Roughs",
          main_contact_name: "Dev Manual",
          main_contact_email: "dev.manual@example.com",
          main_contact_phone: "0123456789",
          quantity_required_sprig_sod: [
            {
              id: globalThis.crypto?.randomUUID?.() ?? `${marker}-g1`,
              product_id: firstProductId,
              quantity: "500",
              uom: "M2",
            },
          ],
        },
      };

      const saveResponse = await updateMondayProjectParentItem(payload);
      const saveResponseRec = saveResponse as Record<string, unknown>;
      const saveResponseProject =
        saveResponseRec.project && typeof saveResponseRec.project === "object"
          ? (saveResponseRec.project as Record<string, unknown>)
          : null;
      const projectId = toStr(saveResponseProject?.id);
      if (!projectId) {
        appendLog("error", "Project manual test created row but missing project.id.");
        return;
      }
      const dynamicRows = await stsProxyPostJson<unknown[]>(
        STS_API_PATHS.mondayFindDynamicByField,
        { field_name: "project_id", field_value: projectId },
      );
      const rows = Array.isArray(dynamicRows) ? dynamicRows : [];
      const createdBy = toStr((rows[0] as Record<string, unknown> | undefined)?.created_by);
      const expectedUid = toStr(user?.id);
      if (expectedUid && createdBy && createdBy !== expectedUid) {
        appendLog(
          "error",
          `Project manual value test failed: created_by=${createdBy}, expected=${expectedUid}.`,
        );
        return;
      }
      appendLog(
        "success",
        `Project manual value test passed (project_id=${projectId}, created_by=${createdBy || "n/a"}).`,
      );
    } catch (e) {
      appendLog("error", e instanceof Error ? e.message : "Project manual value test failed.");
    } finally {
      setBusyKey("");
    }
  };

  const runHarvestImportValueTest = async () => {
    setBusyKey("harvest-import");
    try {
      await ensureRefs();
      const projectId = toStr((projects[0] as Record<string, unknown> | undefined)?.id);
      if (!projectId) throw new Error("No project found to run harvest test.");
      if (!firstFarmId) throw new Error("No farm found to run harvest test.");
      if (!firstProductId) throw new Error("No product found to run harvest test.");
      const marker = randomMarker("dev-harvest");
      const userId = toStr(user?.id);

      await submitFlutterHarvest(
        {
          projectId,
          productId: firstProductId,
          farmId: firstFarmId,
          zone: "A",
          quantity: "1",
          uom: "Kg",
          harvestType: "Sprig",
          estimatedHarvestDate: "2026-01-20",
          actualHarvestDate: "2026-01-21",
          deliveryHarvestDate: "2026-01-22",
          doSoNumber: marker,
          truckNote: `DEV TEST ${marker}`,
          licensePlate: `DEV-${Math.floor(Math.random() * 999)}`,
          assignedTo: userId,
          createdBy: userId || undefined,
          harvestedArea: "1",
        },
        {},
      );

      const list = await stsProxyGetHarvestingIndex({
        project_id: projectId,
        page: 1,
        per_page: 100,
      });
      const matched = list.rows.find((row) => {
        if (!row || typeof row !== "object") return false;
        return toStr((row as Record<string, unknown>).do_so_number) === marker;
      }) as Record<string, unknown> | undefined;
      if (!matched) {
        appendLog("error", "Harvest test row not found after submit.");
        return;
      }
      const createdBy = toStr(matched.created_by);
      if (userId && createdBy && createdBy !== userId) {
        appendLog(
          "error",
          `Harvest import value test failed: created_by=${createdBy}, expected=${userId}.`,
        );
        return;
      }
      appendLog(
        "success",
        `Harvest import value test passed (do_so_number=${marker}, created_by=${createdBy || "n/a"}).`,
      );
    } catch (e) {
      appendLog(
        "error",
        e instanceof Error ? e.message : "Harvest import value test failed.",
      );
    } finally {
      setBusyKey("");
    }
  };

  const runHarvestManualValueTest = async () => {
    setBusyKey("harvest-manual");
    try {
      await ensureRefs();
      const projectId = toStr((projects[0] as Record<string, unknown> | undefined)?.id);
      if (!projectId) throw new Error("No project found to run harvest manual test.");
      if (!firstFarmId) throw new Error("No farm found to run harvest manual test.");
      if (!firstProductId) throw new Error("No product found to run harvest manual test.");
      const marker = randomMarker("dev-harvest-manual");
      const userId = toStr(user?.id);

      await submitFlutterHarvest(
        {
          projectId,
          productId: firstProductId,
          farmId: firstFarmId,
          zone: "B",
          quantity: "2",
          uom: "Kg",
          harvestType: "Sprig",
          estimatedHarvestDate: "2026-03-01",
          actualHarvestDate: "2026-03-02",
          deliveryHarvestDate: "2026-03-03",
          shipmentRequiredDate: "2026-03-05",
          doSoDate: "2026-03-03",
          doSoNumber: marker,
          truckNote: `DEV MANUAL ${marker}`,
          description: `Manual harvest test ${marker}`,
          licensePlate: `MNL-${Math.floor(Math.random() * 999)}`,
          assignedTo: userId,
          createdBy: userId || undefined,
          harvestedArea: "2",
        },
        {},
      );

      const list = await stsProxyGetHarvestingIndex({
        project_id: projectId,
        page: 1,
        per_page: 100,
      });
      const matched = list.rows.find((row) => {
        if (!row || typeof row !== "object") return false;
        return toStr((row as Record<string, unknown>).do_so_number) === marker;
      }) as Record<string, unknown> | undefined;
      if (!matched) {
        appendLog("error", "Harvest manual test row not found after submit.");
        return;
      }
      const createdBy = toStr(matched.created_by);
      if (userId && createdBy && createdBy !== userId) {
        appendLog(
          "error",
          `Harvest manual value test failed: created_by=${createdBy}, expected=${userId}.`,
        );
        return;
      }
      appendLog(
        "success",
        `Harvest manual value test passed (do_so_number=${marker}, created_by=${createdBy || "n/a"}).`,
      );
    } catch (e) {
      appendLog("error", e instanceof Error ? e.message : "Harvest manual value test failed.");
    } finally {
      setBusyKey("");
    }
  };

  const generateExcelSamples = async () => {
    setBusyKey("excel");
    try {
      const marker = randomMarker("excel");
      const projectWb = XLSX.utils.book_new();
      const projectRows = [
        {
          "Project Name": `DEV-IMPORT-${marker}`,
          Company: "DEV TEST COMPANY",
          "Golf Club": "DEV CLUB",
          Architect: "DEV Architect",
          Country: "Vietnam",
          "STS PIC": "1",
          "Estimate Start Date": "10/1/2026",
          "Actual Start Date": "15/1/2026",
          "End Date": "15/12/2026",
          "Project Type": "Golf Course - New",
          Holes: "18",
          "Key Areas": "Tees,Roughs,Fairways,Greens",
          Grass: "1",
          "Sod/Sprig": "Sprig",
          Required: "1000",
        },
      ];
      XLSX.utils.book_append_sheet(
        projectWb,
        XLSX.utils.json_to_sheet(projectRows),
        "projects",
      );
      XLSX.writeFile(projectWb, `dev-project-import-${marker}.xlsx`);

      const harvestWb = XLSX.utils.book_new();
      const harvestRows = [
        {
          "Customer Name": "DEV TEST CUSTOMER",
          "Project Name": "Use existing project name",
          Farm: "Use existing farm name",
          Zone: "A",
          Grass: "Use existing grass name",
          "Harvest Type": "Sprig",
          Quantity: "1",
          "Estimated Harvest Date": "20/1/2026",
          "Actual Harvest Date": "21/1/2026",
          "Delivery Harvest Date": "22/1/2026",
          "DO SO Number": `DEV-H-${marker}`,
          "DO SO Date": "22/1/2026",
          "Truck Note": "DEV import test",
          "License Plate": "DEV-001",
          "Harvested Area": "1",
        },
      ];
      XLSX.utils.book_append_sheet(
        harvestWb,
        XLSX.utils.json_to_sheet(harvestRows),
        "harvest",
      );
      XLSX.writeFile(harvestWb, `dev-harvest-import-${marker}.xlsx`);
      appendLog("success", "Generated project + harvest Excel sample files.");
    } catch (e) {
      appendLog("error", e instanceof Error ? e.message : "Generate Excel samples failed.");
    } finally {
      setBusyKey("");
    }
  };

  const isBusy = busyKey !== "";
  const levelClass: Record<LogLevel, string> = {
    info: "text-gray-700",
    success: "text-green-700",
    error: "text-red-700",
  };

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="mx-auto w-full max-w-5xl space-y-6 p-4 lg:p-8">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold text-gray-900">
              Dev Import/Test Tool (development only)
            </h1>
            <button
              type="button"
              onClick={() => router.push("/projects")}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
            >
              Back
            </button>
          </div>

          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
            Tool này chỉ dùng để test nội bộ ở môi trường development; route bị khóa ở production.
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <button
              type="button"
              onClick={() => void runProjectImportValueTest()}
              disabled={isBusy}
              className="rounded-lg bg-indigo-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
            >
              {busyKey === "project-import" ? "Running..." : "Test Project Import Value"}
            </button>
            <button
              type="button"
              onClick={() => void runProjectManualValueTest()}
              disabled={isBusy}
              className="rounded-lg bg-sky-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
            >
              {busyKey === "project-manual" ? "Running..." : "Test Project Manual Value"}
            </button>
            <button
              type="button"
              onClick={() => void runHarvestImportValueTest()}
              disabled={isBusy}
              className="rounded-lg bg-emerald-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
            >
              {busyKey === "harvest-import" ? "Running..." : "Test Harvest Import Value"}
            </button>
            <button
              type="button"
              onClick={() => void runHarvestManualValueTest()}
              disabled={isBusy}
              className="rounded-lg bg-teal-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
            >
              {busyKey === "harvest-manual" ? "Running..." : "Test Harvest Manual Value"}
            </button>
            <button
              type="button"
              onClick={() => void generateExcelSamples()}
              disabled={isBusy}
              className="rounded-lg bg-amber-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
            >
              {busyKey === "excel" ? "Generating..." : "Generate Excel Samples"}
            </button>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="mb-3 text-lg font-semibold text-gray-900">Logs</h2>
            {!logs.length ? (
              <p className="text-sm text-gray-500">No logs yet.</p>
            ) : (
              <div className="space-y-2">
                {logs.map((log) => (
                  <p key={log.id} className={`text-sm ${levelClass[log.level]}`}>
                    - {log.message}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}

