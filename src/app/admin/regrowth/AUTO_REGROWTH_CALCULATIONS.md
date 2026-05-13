# Auto Regrowth Calculation - Regrowth Config

Tài liệu này mô tả hệ thống tự động tính `inventory_kg_per_m2`, `recovery_days`, `confidence_pct` cho từng farm zone trong trang:

`stsrenew/src/app/admin/regrowth/page.tsx`

UI nằm trong nút `Config` của trang Regrowth Rules. Bảng Zone Configuration chỉ còn cấu hình capacity của zone: farm, grass type, zone number, size m2, yield kg/m2 và total kg.

Backend tính toán chính nằm ở:

`STSPortal/plugins/STSApi/Controllers/Zone_auto_configurations.php`

SQL/migration liên quan:

`STSPortal/app/Database/SQL/zone_auto_configurations_mysql_import.sql`

`STSPortal/app/Database/Migrations/2026-05-08-090000_CreateZoneAutoConfigurationsTables.php`

## 1. Mục tiêu

Mục tiêu cuối cùng của hệ thống là tự động ước tính:

- Số ngày phục hồi của cỏ: `recovery_days`
- Sản lượng có thể thu trên mỗi mét vuông: `inventory_kg_per_m2`
- Tổng kg tối đa trong zone: `max_inventory_kg`
- Độ tin cậy của phép tính: `confidence_pct`
- Diện tích cần thu hoạch khi có quantity kg: `harvested_area_m2`

Khi chuyên gia bật `Auto calculate`, hệ thống dùng dữ liệu cố định của zone, cấu hình chuyên gia, giống cỏ và dữ liệu thời tiết để tính lại mỗi ngày.

## 2. Database

### 2.1. `grass_cultivar_profiles`

Bảng profile giống cỏ. Mỗi loại cỏ có baseline riêng.

Các cột quan trọng:

- `cultivar_key`: mã loại cỏ
- `display_name`: tên hiển thị
- `grass_group`: nhóm cỏ, ví dụ `zoysia`, `bermuda`, `bahia`
- `base_inventory_kg_per_m2`: sản lượng nền kg/m2
- `base_recovery_days`: số ngày phục hồi nền
- `recovery_multiplier`: hệ số riêng theo cultivar
- `min_recovery_days`: số ngày phục hồi tối thiểu
- `max_recovery_days`: số ngày phục hồi tối đa
- `optimum_temp_min_c`: nhiệt độ tối ưu thấp nhất
- `optimum_temp_max_c`: nhiệt độ tối ưu cao nhất
- `drought_tolerance_score`: khả năng chịu hạn
- `shade_tolerance_score`: khả năng chịu bóng
- `nitrogen_response_score`: mức phản ứng với nitrogen
- `recovery_vigor_score`: sức phục hồi
- `default_mowing_height_mm`: chiều cao cắt mặc định
- `default_nitrogen_kg_ha_month`: nitrogen mặc định

Các profile seed hiện có:

| Grass | Group | Base kg/m2 | Base days | Multiplier | Min days | Max days | Default mow mm | Default N kg/ha/month |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Stadium Zoysia | zoysia | 2.600 | 90 | 0.900 | 18 | 160 | 18 | 18 |
| Lynkz Zoysia | zoysia | 2.300 | 90 | 0.950 | 18 | 160 | 4 | 15 |
| Zeon Zoysia | zoysia | 2.200 | 90 | 1.150 | 20 | 180 | 25 | 18 |
| Primo Zoysia | zoysia | 2.200 | 90 | 1.050 | 20 | 170 | 6 | 15 |
| TifEagle Bermuda | bermuda | 2.700 | 90 | 0.750 | 15 | 140 | 3 | 30 |
| Pensacola Bahia Grass | bahia | 1.600 | 90 | 1.200 | 25 | 200 | 85 | 10 |

### 2.2. `zone_auto_configurations`

Bảng cấu hình auto cho từng zone.

Các input chuyên gia nhập:

- `auto_enabled`
- `grass_cultivar_profile_id`
- `weather_location_id`
- `management_level`
- `soil_type`
- `soil_factor`
- `drainage_score`
- `ph_value`
- `organic_matter_pct`
- `compaction_score`
- `shade_percent`
- `irrigation_mode`
- `irrigation_mm_per_week`
- `nitrogen_kg_ha_month`
- `potassium_factor`
- `mowing_height_mm`
- `mowing_frequency_per_week`
- `traffic_level`
- `pest_disease_risk_score`
- `allow_auto_update_inventory`
- `allow_auto_fill_harvest_area`

Các output hệ thống ghi lại:

- `last_inventory_kg_per_m2`
- `last_recovery_days`
- `last_confidence_pct`
- `last_factor_json`
- `last_reason_json`
- `last_calculated_at`

### 2.3. `zone_auto_config_runs`

Bảng lịch sử chạy mỗi ngày.

Mỗi lần tính sẽ lưu:

- zone nào được tính
- ngày chạy
- location thời tiết
- số ngày dùng forecast
- số ngày dùng climate baseline
- snapshot thời tiết
- input factors
- output
- `inventory_kg_per_m2`
- `recovery_days`
- `confidence_pct`

### 2.4. `weather_climate_normals`

Bảng baseline khí hậu theo location và tháng.

Bảng này dùng cho các ngày vượt quá forecast window. Ví dụ forecast chỉ có 15 ngày, nhưng cỏ cần 90 ngày phục hồi, thì ngày 16-90 dùng climate normal theo tháng.

## 3. Luồng tính toán

### 3.1. Khi bấm Save changes

Frontend gọi:

`saveZoneConfiguration()`

Sau đó nếu zone có auto:

`saveZoneAutoConfiguration()`

Nếu `auto_enabled = 1`, backend tự tính ngay và ghi lại kết quả.

### 3.2. Khi bấm Calculate

Frontend gọi:

`calculateZoneAutoConfiguration(zoneConfigurationId)`

Backend chạy:

`Zone_auto_configurations::calculate()`

Sau đó gọi:

`calculateAndPersist()`

### 3.3. Khi chạy tự động mỗi ngày

API:

`POST /api/zone_auto_configurations/run_daily`

Backend lấy tất cả rows:

- `auto_enabled = 1`
- `status = active`
- `deleted = 0`

Sau đó tính lại từng zone và lưu vào `zone_auto_config_runs`.

## 4. Công thức tổng quát

### 4.1. Base recovery days

```text
baseDays = grass.base_recovery_days * grass.recovery_multiplier
```

Ví dụ Stadium Zoysia:

```text
baseDays = 90 * 0.900 = 81 days
```

### 4.2. Weather horizon

```text
horizonDays = clamp(round(baseDays), 30, 220)
```

Nếu base days là 81, hệ thống xem điều kiện thời tiết trong 81 ngày.

## 5. Cách dùng thời tiết

Với mỗi ngày trong `horizonDays`:

1. Nếu có dữ liệu trong `sts_open_meteo_daily_summaries`, dùng forecast mới nhất.
2. Nếu không có forecast, dùng `weather_climate_normals` theo tháng.
3. Nếu không có climate normal, fallback về:
   - nhiệt độ trung bình tối ưu của loại cỏ
   - mưa 2 mm/ngày
   - ET0 4.5 mm/ngày

### 5.1. Temperature score

Nếu nhiệt độ trung bình nằm trong khoảng tối ưu:

```text
temperatureScore = 1.05
```

Nếu lạnh hơn optimum min:

```text
temperatureScore = clamp(1 - ((optimumMin - avgTemp) / 12), 0.45, 1.00)
```

Nếu nóng hơn optimum max:

```text
temperatureScore = clamp(1 - ((avgTemp - optimumMax) / 10), 0.45, 1.00)
```

### 5.2. Water score

```text
irrigationMmPerDay = irrigation_mm_per_week / 7
waterMm = precipitationMm + irrigationMmPerDay
targetWater = max(3.0, et0)
waterRatio = waterMm / targetWater
```

Nếu nước quá dư:

```text
if waterRatio > 2.2:
  waterScore = 0.92
```

Nếu không:

```text
waterScore = clamp(waterRatio, 0.50, 1.10)
```

### 5.3. Daily weather score

```text
dailyWeatherScore = clamp((temperatureScore * 0.65) + (waterScore * 0.35), 0.55, 1.15)
```

### 5.4. Weather factor

```text
weatherFactor = average(dailyWeatherScore over horizonDays)
weatherFactor = clamp(weatherFactor, 0.55, 1.15)
```

## 6. Growth factor

Growth factor là hệ số làm cỏ hồi phục nhanh hơn và tăng kg/m2.

```text
growthFactor = clamp(
  weatherFactor
  * soilFactor
  * drainageFactor
  * shadeFactor
  * nitrogenFactor
  * potassiumFactor
  * mowingFactor
  * managementFactor
  * compactionFactor,
  0.45,
  1.45
)
```

### 6.1. Soil factor

```text
soilFactor = expert input
```

Backend giới hạn:

```text
soilFactor = clamp(soilFactor, 0.50, 1.40)
```

Ý nghĩa:

- `1.00`: trung bình
- `< 1.00`: đất hạn chế sinh trưởng
- `> 1.00`: đất tốt hơn baseline

### 6.2. Drainage factor

```text
drainageFactor = clamp(0.75 + (drainageScore * 0.35), 0.65, 1.10)
```

`drainageScore` từ 0 đến 1.

### 6.3. Shade factor

```text
shadeFactor = clamp(
  1 - ((shadePercent / 100) * (1 - grass.shade_tolerance_score)),
  0.45,
  1.02
)
```

Cỏ chịu bóng tốt sẽ ít bị phạt hơn khi `shadePercent` cao.

### 6.4. Nitrogen factor

```text
defaultN = grass.default_nitrogen_kg_ha_month
nitrogenRatio = nitrogen_kg_ha_month / defaultN
nitrogenFactor = clamp(
  1 + ((nitrogenRatio - 1) * grass.nitrogen_response_score),
  0.65,
  1.18
)
```

Nếu bón N cao hơn default, cỏ tăng tốc phục hồi nhưng bị giới hạn tối đa `1.18`.

### 6.5. Potassium factor

```text
potassiumFactor = clamp(inputPotassiumFactor, 0.75, 1.15)
```

### 6.6. Mowing factor

```text
defaultMowing = grass.default_mowing_height_mm
mowingRatio = mowing_height_mm / defaultMowing
mowingFactor = clamp(
  1 - min(abs(mowingRatio - 1) * 0.18, 0.22),
  0.78,
  1.05
)
```

Nếu mowing frequency thấp hơn 1 lần/tuần:

```text
mowingFactor = mowingFactor * 0.95
```

### 6.7. Management factor

```text
low = 0.90
standard = 1.00
high/intensive = 1.07
```

### 6.8. Compaction factor

```text
compactionFactor = clamp(1 - (compactionScore * 0.22), 0.76, 1.00)
```

`compactionScore` từ 0 đến 1. Compaction càng cao thì growth càng thấp.

## 7. Stress factor

Stress factor làm tăng số ngày phục hồi và giảm kg/m2.

```text
stressFactor = clamp(
  1
  + (pestDiseaseRiskScore * 0.32)
  + (trafficLevel * 0.18)
  + phPenalty
  + drainageStress,
  1.00,
  1.75
)
```

### 7.1. pH penalty

Mốc pH trung tâm là `6.4`.

```text
phPenalty = max(0, min(0.25, (abs(phValue - 6.4) - 0.5) * 0.08))
```

Nếu pH lệch nhẹ trong khoảng 0.5 thì không bị phạt.

### 7.2. Traffic stress

```text
trafficStress = trafficLevel * 0.18
```

### 7.3. Pest/disease stress

```text
pestDiseaseStress = pestDiseaseRiskScore * 0.32
```

### 7.4. Drainage stress

Nếu drainage thấp hơn 0.60:

```text
drainageStress = max(0, 0.60 - drainageScore) * 0.18
```

## 8. Output formulas

### 8.1. Auto inventory kg/m2

```text
inventory_kg_per_m2 = clamp(
  grass.base_inventory_kg_per_m2 * growthFactor / stressFactor,
  0.20,
  6.00
)
```

Backend round:

```text
inventory_kg_per_m2 = round(inventory_kg_per_m2, 3)
```

### 8.2. Recovery days

```text
recovery_days = round(
  clamp(
    baseDays * stressFactor / growthFactor,
    grass.min_recovery_days,
    grass.max_recovery_days
  )
)
```

Nếu growth tốt, recovery days giảm. Nếu stress cao, recovery days tăng.

### 8.3. Max inventory kg

Nếu `allow_auto_update_inventory = 1`, backend cập nhật lại zone:

```text
zone_configurations.inventory_kg_per_m2 = inventory_kg_per_m2
zone_configurations.max_inventory_kg = zone_configurations.size_m2 * inventory_kg_per_m2
```

### 8.4. Harvested area estimate

API estimate harvest area dùng:

```text
harvested_area_m2 = quantity_kg / inventory_kg_per_m2
```

Nếu zone đã có auto result mới nhất, dùng `last_inventory_kg_per_m2`. Nếu chưa có, dùng `zone_configurations.inventory_kg_per_m2`.

## 9. Confidence

Confidence là độ tin cậy của model, không phải cam kết chính xác tuyệt đối.

```text
weatherCoverage = min(
  1,
  (forecastDaysUsed + climateBaselineDaysUsed * 0.45) / horizonDays
)
```

```text
configCompleteness = completedExpertInputs / totalExpertInputs
```

Các input tính completeness:

- `soil_factor`
- `drainage_score`
- `ph_value`
- `organic_matter_pct`
- `compaction_score`
- `shade_percent`
- `irrigation_mm_per_week`
- `nitrogen_kg_ha_month`
- `mowing_height_mm`
- `traffic_level`
- `pest_disease_risk_score`

Formula:

```text
confidence = 40
  + (weatherCoverage * 30)
  + (configCompleteness * 18)
  - (pestDiseaseRiskScore * 4)
  - (max(0, shadePercent - 30) * 0.08)

confidence = clamp(confidence, 30, 92)
```

## 10. Các yếu tố chuyên gia cần nhập

### Bắt buộc để auto chạy tốt

- Grass profile đúng với loại cỏ
- Weather location đúng với farm
- Soil factor
- Drainage score
- Shade percent
- Compaction score
- Irrigation mm/week
- Nitrogen kg/ha/month
- Mowing height mm
- Traffic level
- Pest/disease risk
- pH

### Có thể để default ban đầu

- Management level: `standard`
- Soil type: `sandy_loam`
- Organic matter: `2.5`
- Potassium factor: `1.0`
- Mowing frequency: `2`
- Irrigation mode: `scheduled`

## 11. Ngày sau forecast window được tính thế nào

Ví dụ API thời tiết chỉ có 15 ngày, nhưng cỏ cần 90 ngày:

- Ngày 1-15: dùng forecast từ `sts_open_meteo_daily_summaries`
- Ngày 16-90: dùng monthly climate normal từ `weather_climate_normals`
- Nếu tháng/location không có climate normal: dùng fallback nội bộ

Vì vậy hệ thống vẫn tính được `recovery_days` dài hơn forecast window. Tuy nhiên confidence sẽ thấp hơn vì climate normal chỉ được tính `0.45` trọng số trong coverage.

## 12. Nút Config và tooltip trong UI

Trong `stsrenew/src/app/admin/regrowth/page.tsx`, bấm nút `Config` để mở modal Auto Regrowth Config. Mỗi field auto setup có dấu hỏi kế bên label. Hover hoặc focus vào dấu hỏi sẽ hiển thị:

- Field đó ảnh hưởng công thức nào
- Range/ý nghĩa input
- Cách backend biến input thành factor

Khối `Auto recovery formula` trong modal hiển thị công thức tổng quát:

```text
recoveryDays = baseDays * stressFactor / growthFactor
autoYieldKgM2 = baseInventory * growthFactor / stressFactor
```

## 13. Giới hạn hiện tại

Hiện tại `date_planted` chỉ lưu metadata. Nó chưa được đưa vào công thức maturity/age.

`organic_matter_pct` hiện được lưu và tính vào config completeness/confidence, nhưng chưa trực tiếp làm tăng hoặc giảm `growthFactor`.

`soil_type` và `irrigation_mode` được lưu để mở rộng sau, nhưng công thức hiện tại chưa dùng trực tiếp.

Để tăng độ chính xác, cần calibrate bằng dữ liệu thực tế:

- ngày thu hoạch thực tế
- kg/m2 thực tế
- ngày phục hồi thực tế
- tình trạng sâu bệnh thực tế
- lượng nước tưới thực tế
- lịch bón phân thực tế

Sau khi có dữ liệu thực tế, nên điều chỉnh:

- `base_inventory_kg_per_m2`
- `base_recovery_days`
- `recovery_multiplier`
- `shade_tolerance_score`
- `nitrogen_response_score`
- `recovery_vigor_score`
- default mowing/N cho từng grass profile
