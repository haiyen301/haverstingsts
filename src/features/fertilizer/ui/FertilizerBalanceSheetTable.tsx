"use client";

import { cn } from "@/lib/utils";
import {
  FERTILIZER_BALANCE_COLORS,
  FERTILIZER_BALANCE_COMPANY,
} from "@/features/fertilizer/lib/fertilizerBalanceColors";
import {
  formatBalanceQty,
  type FertilizerBalanceSheetModel,
} from "@/features/fertilizer/lib/fertilizerBalanceSheetData";

const cellBase = "border border-black px-1 py-0.5 text-center text-[11px] leading-tight align-middle";
const headerBase = cn(cellBase, "font-semibold whitespace-nowrap");

function inventoryEndDateLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

type Props = {
  model: FertilizerBalanceSheetModel;
  className?: string;
};

export function FertilizerBalanceSheetTable({ model, className }: Props) {
  return (
    <div className={cn("overflow-x-auto bg-white text-black", className)}>
      <table className="min-w-[1280px] w-full border-collapse font-sans">
        <tbody>
          <tr>
            <td className="border-0" colSpan={5} />
            <td className="border-0 px-1 py-0.5 text-[11px]" colSpan={8}>
              {FERTILIZER_BALANCE_COMPANY.name}
            </td>
          </tr>
          <tr>
            <td className="border-0" colSpan={5} />
            <td className="border-0 px-1 py-0.5 text-[11px]" colSpan={8}>
              {FERTILIZER_BALANCE_COMPANY.address1}
            </td>
          </tr>
          <tr>
            <td className="border-0" colSpan={5} />
            <td className="border-0 px-1 py-0.5 text-[11px]" colSpan={8}>
              {FERTILIZER_BALANCE_COMPANY.address2}
            </td>
          </tr>
          <tr>
            <td className="border-0" colSpan={5} />
            <td className="border-0 px-1 py-0.5 text-[11px]" colSpan={8}>
              {FERTILIZER_BALANCE_COMPANY.taxCode}
            </td>
          </tr>
          <tr>
            <td
              className={cn(cellBase, "py-2 text-sm font-bold")}
              colSpan={29}
              style={{ backgroundColor: `#${FERTILIZER_BALANCE_COLORS.titleBg}` }}
            >
              BIÊN BẢN SẢN LƯỢNG PHÂN/HOÁ CHẤT CÒN LẠI TRONG KHO
            </td>
          </tr>
          <tr>
            <td className={cn(cellBase, "py-1 text-xs font-semibold")} colSpan={29}>
              MINUTES OF MONTHLYN FERTILIZER/CHEMICALS BALANCE IN STOCK
            </td>
          </tr>

          <tr>
            <td className={headerBase} rowSpan={2}>
              No
            </td>
            <td className={headerBase}>Item Code</td>
            <td className={headerBase} rowSpan={2}>
              Description
            </td>
            <td className={headerBase} rowSpan={2}>
              Unit
            </td>
            <td className={headerBase} rowSpan={2}>
              OPEN
            </td>
            {model.weekLabels.map((label) => (
              <td
                key={label}
                className={headerBase}
                colSpan={4}
                style={{ whiteSpace: "normal" }}
              >
                {label}
              </td>
            ))}
            <td
              className={headerBase}
              colSpan={3}
              style={{ backgroundColor: `#${FERTILIZER_BALANCE_COLORS.monthTotalHeader}` }}
            >
              Tổng sử dụng/tháng
            </td>
            <td className="border-0" colSpan={2} />
            <td
              className={headerBase}
              colSpan={3}
              style={{ backgroundColor: `#${FERTILIZER_BALANCE_COLORS.monthTotalHeader}` }}
            >
              Số lượng còn trong kho {inventoryEndDateLabel(model.monthEndYmd)}
            </td>
          </tr>
          <tr>
            <td className={headerBase}>Mã vật tư</td>
            {Array.from({ length: 4 }).map((_, wIdx) => (
              <WeekSubHeaders key={`wk-sub-${wIdx}`} />
            ))}
            <td
              className={headerBase}
              style={{ backgroundColor: `#${FERTILIZER_BALANCE_COLORS.importHeader}` }}
            >
              Import
            </td>
            <td
              className={headerBase}
              style={{ backgroundColor: `#${FERTILIZER_BALANCE_COLORS.transferHeader}` }}
            >
              Transfer
            </td>
            <td
              className={headerBase}
              style={{
                backgroundColor: `#${FERTILIZER_BALANCE_COLORS.consumpHeader}`,
                color: `#${FERTILIZER_BALANCE_COLORS.headerTextOnRed}`,
              }}
            >
              Consump
            </td>
            <td className="border-0" colSpan={2} />
            <td className={headerBase} colSpan={3} />
          </tr>

          {model.productRows.map((product, i) => {
            const showInventory =
              product.monthEndBalance !== 0 ||
              product.open !== 0 ||
              product.monthTotal.import !== 0 ||
              product.monthTotal.transfer !== 0 ||
              product.monthTotal.consumption !== 0;
            return (
              <tr key={`data-${product.itemId}`}>
                <td className={cellBase}>{i + 1}</td>
                <td className={cellBase}>{product.itemCode}</td>
                <td className={cn(cellBase, "text-left")}>{product.description}</td>
                <td className={cellBase}>{product.unit}</td>
                <td
                  className={cn(cellBase, "tabular-nums")}
                  style={{ backgroundColor: `#${FERTILIZER_BALANCE_COLORS.openCell}` }}
                >
                  {formatBalanceQty(product.open)}
                </td>
                {product.weeks.map((wk, wIdx) => (
                  <WeekDataCells key={`${product.itemId}-w-${wIdx}`} week={wk} />
                ))}
                <td className={cn(cellBase, "tabular-nums")}>
                  {formatBalanceQty(product.monthTotal.import)}
                </td>
                <td className={cn(cellBase, "tabular-nums")}>
                  {formatBalanceQty(product.monthTotal.transfer)}
                </td>
                <td className={cn(cellBase, "tabular-nums")}>
                  {formatBalanceQty(product.monthTotal.consumption)}
                </td>
                <td className="border-0" colSpan={2} />
                <td className={cn(cellBase, "text-left")}>
                  {showInventory ? product.description : ""}
                </td>
                <td className={cellBase}>{showInventory ? product.unit : ""}</td>
                <td
                  className={cn(cellBase, "tabular-nums font-semibold")}
                  style={{
                    color: showInventory
                      ? `#${FERTILIZER_BALANCE_COLORS.inventoryQtyText}`
                      : undefined,
                  }}
                >
                  {showInventory ? formatBalanceQty(product.monthEndBalance) : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WeekSubHeaders() {
  return (
    <>
      <td
        className={headerBase}
        style={{ backgroundColor: `#${FERTILIZER_BALANCE_COLORS.importHeader}` }}
      >
        Import
      </td>
      <td
        className={headerBase}
        style={{ backgroundColor: `#${FERTILIZER_BALANCE_COLORS.transferHeader}` }}
      >
        Transfer
      </td>
      <td
        className={headerBase}
        style={{
          backgroundColor: `#${FERTILIZER_BALANCE_COLORS.consumpHeader}`,
          color: `#${FERTILIZER_BALANCE_COLORS.headerTextOnRed}`,
        }}
      >
        Consump
      </td>
      <td
        className={headerBase}
        style={{ backgroundColor: `#${FERTILIZER_BALANCE_COLORS.balanceHeader}` }}
      >
        Balance
      </td>
    </>
  );
}

function WeekDataCells({
  week,
}: {
  week: {
    import: number;
    transfer: number;
    consumption: number;
    balance: number;
  } | null;
}) {
  if (!week) {
    return (
      <>
        <td className={cellBase} />
        <td className={cellBase} />
        <td className={cellBase} />
        <td className={cellBase} />
      </>
    );
  }
  return (
    <>
      <td className={cn(cellBase, "tabular-nums")}>{formatBalanceQty(week.import)}</td>
      <td className={cn(cellBase, "tabular-nums")}>{formatBalanceQty(week.transfer)}</td>
      <td className={cn(cellBase, "tabular-nums")}>{formatBalanceQty(week.consumption)}</td>
      <td className={cn(cellBase, "tabular-nums")}>{formatBalanceQty(week.balance)}</td>
    </>
  );
}
