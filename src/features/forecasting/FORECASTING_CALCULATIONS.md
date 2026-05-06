# Forecasting Calculations - Harvesting Portal Reference

Tai lieu nay bam sat cach tinh trong:

```txt
/Users/nguyenthi/Desktop/Harvesting Portal/src/pages/ForecastingPage.tsx
```

Muc dich la ghi lai cong thuc cua cac phan:

- Projected Available Inventory
- Projected Available Inventory by Grass Type / by Farm
- Upcoming Harvests Driving the Forecast
- Upcoming Regrowth Events
- Regrowth Reference

## 1. Data dau vao

`ForecastingPage.tsx` khong chi dung `legacyHarvests`. No merge 2 nguon:

```txt
harvests = legacyHarvests + projectHarvests
```

### 1.1. Legacy harvests

Lay tu:

```ts
import { harvests as legacyHarvests } from "@/data/harvests";
```

### 1.2. Project harvests

Lay tu:

```ts
const { projects } = useProjects();
```

Sau do convert moi `p.harvests` thanh dang `Harvest`:

```txt
id              = h.id
customer        = p.customerName
project         = p.projectName
grassType       = h.grassType
zone            = h.zone || undefined
harvestType     = h.harvestType ?? "SPRIG"
harvestedAreaM2 = h.areaM2 || 0
quantityKg      = h.quantityKg
kgPerM2         = area > 0 ? h.quantityKg / area : 1
farmName        = h.farmName
country         = getCountryForFarm(h.farmName)
estDate         = h.estDate
harvestDate     = h.harvestDate
deliveryDate    = h.deliveryDate
```

### 1.3. Zone config

Forecast tinh tren `farmZones`:

```ts
const { zones: farmZones } = useZoneConfig();
```

Moi zone co cac field quan trong:

```txt
farmName
turfgrass
zone
sizeM2
inventoryKgPerM2
maxInventoryKg = sizeM2 * inventoryKgPerM2
```

Khi user chon farm/grass, zones duoc filter:

```txt
zones = farmZones where:
  (!filterFarm || zone.farmName === filterFarm)
  &&
  (!filterGrass || zone.turfgrass === filterGrass)
```

## 2. Regrowth Reference

So ngay regrowth lay qua:

```ts
getRegrowthDays(h.harvestType, h.kgPerM2)
```

`getRegrowthDays` doc theo `RegrowthConfigContext.tsx`:

```txt
Neu harvestType = "SOD":
  regrowthDays = config.sodDays

Neu harvestType = "SOD_FOR_SPRIG":
  regrowthDays = config.sodForSprigDays

Neu harvestType = "SPRIG":
  lay theo sprigBands dua vao kgPerM2
```

Default config:

```txt
sodDays = 120
sodForSprigDays = 120
overrideRecoveryDays = 120

SPRIG bands:
  kgPerM2 <= 1.0       -> 30 days
  kgPerM2 <= 1.5       -> 45 days
  kgPerM2 <= 2.5       -> 60 days
  kgPerM2 <= 3.5       -> 75 days
  kgPerM2 > 3.5        -> 90 days
```

Bang nay hien trong UI o section `Regrowth Reference`.

## 3. Normalize zone va effective harvest date

### 3.1. Normalize zone

ForecastingPage co helper:

```ts
function normalizeZone(harvestZone: string): string {
  return harvestZone.replace(/^[A-Z]+/, "");
}
```

Vi du:

```txt
SZ1 -> 1
LZ1 -> 1
Zone "1" -> 1
```

Khi gom harvest vao zone, code dung:

```txt
h.farmName === zone.farmName
h.grassType === zone.turfgrass
(h.zone ? normalizeZone(h.zone) === zone.zone : true)
```

Luu y quan trong:

```txt
Neu h.zone rong/undefined thi harvest do match moi zone cung farm + grass.
```

### 3.2. Effective date

Trong `forecastData`, effective date la:

```txt
effectiveDate = h.harvestDate neu co
              = h.estDate neu khong co harvestDate
              = null neu ca hai deu khong co
```

Code:

```ts
const getEffectiveDate = (h) => {
  if (h.harvestDate) return h.harvestDate;
  if (h.estDate) return h.estDate;
  return null;
};
```

## 4. Projected Available Inventory

Section nay tinh `forecastData`.

### 4.1. Moc thoi gian

Trong ban Harvesting Portal, ngay hien tai duoc hardcode:

```txt
today = 2026-04-15
```

So diem forecast:

```txt
totalWeeks = round(forecastMonths * 4.33)
```

Moi diem cach nhau 7 ngay:

```txt
forecastDate(w) = today + w * 7 days
```

`forecastMonths` co cac lua chon:

```txt
6, 12, 18
```

### 4.2. Max inventory

Tai moi forecast point:

```txt
totalMax = sum(zone.maxInventoryKg cua cac zone sau filter)
```

Voi tung zone:

```txt
totalMax += zone.maxInventoryKg
```

### 4.3. Cong thuc depletion khi khong co override

Voi moi zone:

```txt
depleted = 0
```

Voi moi harvest cua zone:

```txt
effDate = harvestDate || estDate
Neu khong co effDate:
  bo qua

hDate = new Date(effDate)
Neu hDate > forecastDate:
  bo qua vi harvest chua xay ra tai moc forecast nay

regrowDays = getRegrowthDays(h.harvestType, h.kgPerM2)
regrowDate = hDate + regrowDays

Neu regrowDate > forecastDate:
  elapsed = (forecastDate - hDate) / millisecondsPerDay
  progress = clamp(elapsed / regrowDays, 0, 1)
  remaining = h.quantityKg * (1 - progress)

  depleted += remaining
  totalRegrowing += remaining
```

Sau khi xu ly harvests cua zone:

```txt
zoneAvailable = max(0, zone.maxInventoryKg - depleted)
totalAvailable += zoneAvailable
```

Ket qua push vao chart:

```txt
available = round(totalAvailable)
regrowing = round(totalRegrowing)
max       = totalMax
```

### 4.4. Y nghia cong thuc regrowth tuyen tinh

Neu harvest lay `quantityKg` ra khoi inventory, no quay lai dan dan tu harvest date den regrow date.

```txt
progress = elapsedDays / regrowDays
remaining = quantityKg * (1 - progress)
```

Vi du:

```txt
quantityKg = 1,000
regrowDays = 40
elapsedDays = 10

progress = 10 / 40 = 0.25
remaining = 1,000 * (1 - 0.25) = 750
```

Tai moc do inventory cua zone bi tru 750kg. 250kg duoc xem la da regrow lai.

## 5. Manual Inventory Override trong Projected Available Inventory

ForecastingPage co override:

```ts
const override = getOverrideFull(zone.farmName, zone.turfgrass, zone.zone);
```

Override co dang:

```txt
{
  key: "farmName-turfgrass-zone",
  updatedKg: number,
  date: string
}
```

### 5.1. Neu forecastDate < overrideDate

Neu moc forecast nam truoc ngay override, code khong dung `updatedKg`.

No tinh binh thuong nhu khong co override:

```txt
zoneAvailable = max(0, zone.maxInventoryKg - depleted)
```

### 5.2. Neu forecastDate >= overrideDate

Code lay `override.updatedKg` lam base inventory.

```txt
daysSinceOverride = (forecastDate - overrideDate) / millisecondsPerDay
deficit = zone.maxInventoryKg - override.updatedKg
baseProjected = override.updatedKg
```

Neu `deficit > 0`, inventory hoi phuc tuyen tinh ve max trong `overrideRecoveryDays`:

```txt
recoveryDays = regrowthConfig.overrideRecoveryDays
recovered = min(deficit, deficit * (daysSinceOverride / recoveryDays))
baseProjected = override.updatedKg + recovered
totalRegrowing += max(0, deficit - recovered)
```

Sau do tru planned harvests sau override:

```txt
plannedDeduction = sum(h.quantityKg) where:
  hDate > overrideDate
  hDate <= forecastDate
```

Ket qua cua zone:

```txt
zoneAvailable = max(
  0,
  min(zone.maxInventoryKg, round(baseProjected - plannedDeduction))
)

totalAvailable += zoneAvailable
```

Luu y:

```txt
Trong nhanh override sau overrideDate, plannedDeduction bi tru full quantity.
No khong dung cong thuc regrowth tuyen tinh cho cac planned harvest sau override.
```

## 6. Projected Available Inventory by Grass Type / by Farm

Section nay tinh `forecastByGrass`, chart stacked area thu hai.

### 6.1. Breakdown mode

Neu user chon mot grass cu the:

```txt
breakdownMode = "farm"
seriesKeys = danh sach farm co zone cua grass do
title = Projected Available Inventory by Farm - {filterGrass}
```

Neu user khong chon grass:

```txt
breakdownMode = "grass"
seriesKeys = danh sach turfgrass tu farmZones sau filter
title = Projected Available Inventory by Grass Type
```

### 6.2. Cong thuc tung series

Chart nay lap qua zones sau filter, giong chart tong:

```txt
for each forecastDate:
  row = { date }
  row[seriesKey] = 0 cho moi seriesKey
```

Voi moi zone:

```txt
zoneHarvests = harvests match farmName + turfgrass + zone
depleted = 0
```

Tinh `depleted` bang cung cong thuc:

```txt
effDate = h.harvestDate || h.estDate
Neu effDate khong co -> bo qua
Neu hDate > forecastDate -> bo qua

regrowDays = getRegrowthDays(h.harvestType, h.kgPerM2)
regrowDate = hDate + regrowDays

Neu regrowDate > forecastDate:
  elapsed = (forecastDate - hDate) / millisecondsPerDay
  progress = clamp(elapsed / regrowDays, 0, 1)
  depleted += h.quantityKg * (1 - progress)
```

Sau do:

```txt
available = max(0, zone.maxInventoryKg - depleted)
```

Chon key de cong vao series:

```txt
key = breakdownMode === "farm" ? zone.farmName : zone.turfgrass
row[key] += round(available)
```

### 6.3. Diem khac voi chart tong

`forecastByGrass` khong xu ly manual override.

No luon dung cong thuc:

```txt
available = max(0, zone.maxInventoryKg - depleted)
```

Trong khi `Projected Available Inventory` co nhanh override voi `override.updatedKg`.

## 7. Upcoming Harvests Driving the Forecast

Section nay tinh `upcomingHarvests`.

### 7.1. Horizon

```txt
today = 2026-04-15
horizonEnd = today + forecastMonths months
```

### 7.2. Dieu kien include

Lay tu `harvests` da merge, sau do filter:

```txt
Neu filterFarm co gia tri va h.farmName !== filterFarm:
  bo qua

Neu filterGrass co gia tri va h.grassType !== filterGrass:
  bo qua

Neu h.deliveryDate co gia tri:
  bo qua vi da delivered

effDate = h.harvestDate || h.estDate
Neu khong co effDate:
  bo qua

d = new Date(effDate)
Include neu:
  d >= today
  d <= horizonEnd
```

### 7.3. Mapping ra UI

```txt
id        = h.id
date      = h.harvestDate || h.estDate
isPlanned = !h.harvestDate
farm      = h.farmName
grass     = h.grassType
zone      = h.zone || "TBD"
qty       = h.quantityKg
type      = h.harvestType
project   = h.project || ""
customer  = h.customer || ""
```

Sap xep:

```txt
sort ascending by date
```

Tong kg tren header:

```txt
upcomingTotalKg = sum(upcomingHarvests.qty)
```

### 7.4. Planned vs Scheduled

UI xac dinh badge:

```txt
Neu !h.harvestDate:
  Planned
Neu co h.harvestDate:
  Scheduled
```

Trong ForecastingPage:

```txt
isPlanned = !h.harvestDate
```

## 8. Upcoming Regrowth Events

Section nay tinh `regrowthEvents`.

### 8.1. Dieu kien va cong thuc

```txt
today = 2026-04-15
events = []
```

Voi moi harvest trong `harvests`:

```txt
Neu filterFarm co gia tri va h.farmName !== filterFarm:
  bo qua

Neu filterGrass co gia tri va h.grassType !== filterGrass:
  bo qua

effDate = h.harvestDate || h.estDate
Neu khong co effDate:
  bo qua

harvestDate = new Date(effDate)
regrowDays = getRegrowthDays(h.harvestType, h.kgPerM2)
regrowDate = harvestDate + regrowDays

Neu regrowDate > today:
  push event
```

Event shape:

```txt
date  = regrowDate.toISOString().split("T")[0]
farm  = h.farmName
grass = h.grassType
zone  = h.zone || "TBD"
qty   = h.quantityKg
type  = h.harvestType
```

Sau do:

```txt
sort ascending by date
take first 15 events
```

### 8.2. Luu y ve horizon

`Upcoming Regrowth Events` khong bi gioi han boi `forecastMonths`.

No chi lay:

```txt
regrowDate > today
```

roi sort va lay 15 event dau tien.

## 9. Tong hop cong thuc cot loi

### 9.1. Regrowth date

```txt
regrowDays = getRegrowthDays(harvestType, kgPerM2)
regrowDate = effectiveDate + regrowDays
```

### 9.2. Remaining depletion

```txt
elapsedDays = forecastDate - effectiveDate
progress = clamp(elapsedDays / regrowDays, 0, 1)
remaining = quantityKg * (1 - progress)
```

### 9.3. Zone available without override

```txt
zoneAvailable = max(0, zone.maxInventoryKg - sum(remaining))
```

### 9.4. Total projected inventory

```txt
totalAvailable = sum(zoneAvailable)
totalRegrowing = sum(remaining)
totalMax = sum(zone.maxInventoryKg)
```

### 9.5. Zone available after override

```txt
deficit = zone.maxInventoryKg - override.updatedKg
recovered = min(deficit, deficit * daysSinceOverride / overrideRecoveryDays)
baseProjected = override.updatedKg + recovered
zoneAvailable = max(0, min(zone.maxInventoryKg, round(baseProjected - plannedDeduction)))
```

## 10. Source map

```txt
ForecastingPage.tsx
  lines 26-58   -> merge legacyHarvests + projectHarvests
  lines 67-182  -> Projected Available Inventory / forecastData
  lines 184-295 -> Projected Available Inventory by Grass Type/Farm / forecastByGrass
  lines 297-332 -> Upcoming Harvests Driving the Forecast
  lines 334-362 -> Upcoming Regrowth Events
  lines 527-550 -> Regrowth Reference UI

RegrowthConfigContext.tsx
  computeRegrowthDays
  DEFAULT_CONFIG

InventoryOverrideContext.tsx
  getOverrideFull
  InventoryOverride.updatedKg/date

ZoneConfigContext.tsx
  farmZones
  maxInventoryKg = sizeM2 * inventoryKgPerM2
```
