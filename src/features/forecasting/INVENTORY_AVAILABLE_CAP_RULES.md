# Inventory Available Cap Rules

This document describes how forecasting keeps `available` inventory under each zone capacity.

## Scope

The cap is applied per inventory bucket:

- `farm_id`
- `zone`
- `product_id` (grass)

Bucket key:

`farm_id|zone|product_id`

## Capacity Source

Capacity for each bucket comes from Zone Configuration:

- `max_inventory_kg`

If no zone config matches, fallback is used from `forecastingInventoryConversion.ts`:

- `DEFAULT_FALLBACK_MAX_INVENTORY_KG = 500000`

## Conversion Source

Harvest plan rows are normalized to kg before forecast math:

- UOM `kg` -> keep as-is
- UOM `m2` -> `quantity * inventory_kg_per_m2`, then row-level cap by `max_inventory_kg`

Output fields on `ForecastHarvestRow`:

- `inventoryKg`
- `inventoryIsCapped`
- `zoneMaxInventoryKg`

## Available Calculation (Zone-Level Cap)

At each forecast date:

1. Sum eligible regrowth per bucket (rows with `regrowDate <= forecastDate`).
2. Cap each bucket:

`available_bucket = min(sum_bucket, max_bucket)`

3. Total available = sum of all capped bucket values.

This guarantees available inventory for a bucket never exceeds its `max_inventory_kg`.

## Regrowth Events Overflow

Upcoming regrowth events are simulated chronologically per bucket.

For each event:

- `beforeRaw` = previous uncapped cumulative
- `beforeCapped` = previous capped cumulative
- `afterRaw = beforeRaw + eventQty`
- `afterCapped = min(afterRaw, max_bucket)`
- `creditedKg = afterCapped - beforeCapped`
- `overflowKg = eventQty - creditedKg`

UI flags:

- `MAX` badge when row/event is capped
- `overflowKg > 0` badge indicates how much could not be credited due to capacity limit

## Files

- `forecastingInventoryConversion.ts`
- `mapHarvestApiToForecastRows.ts`
- `forecastingTypes.ts`
- `inventoryForecastView.tsx`
