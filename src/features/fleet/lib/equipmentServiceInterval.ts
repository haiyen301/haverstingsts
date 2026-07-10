/** Equipment hour-meter fields used for service countdown. */
export type EquipmentHoursFields = {
  hours_used?: number | string | null;
  hours_between_service?: number | string | null;
  hours_at_last_service?: number | string | null;
  last_service_date?: string | null;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function equipmentHasServiceBaseline(equipment: EquipmentHoursFields): boolean {
  return String(equipment.last_service_date ?? "").trim() !== "";
}

export type EquipmentServiceInterval = {
  hoursUsed: number;
  hoursBetween: number;
  hoursAtLastService: number;
  hoursSinceLastService: number;
  hoursUntilService: number;
  serviceProgress: number;
  isOverdue: boolean;
  hasServiceBaseline: boolean;
};

/**
 * Count hours since the last service snapshot, not lifetime modulo.
 * hours_until = hours_between - (hours_used - hours_at_last_service)
 *
 * When no service has been recorded yet, do not treat lifetime hours as overdue.
 */
export function calcEquipmentServiceInterval(
  equipment: EquipmentHoursFields,
  defaultHoursBetween = 250,
): EquipmentServiceInterval {
  const hoursBetween = num(equipment.hours_between_service) || defaultHoursBetween;
  const hoursUsed = num(equipment.hours_used);
  const hasServiceBaseline = equipmentHasServiceBaseline(equipment);

  if (!hasServiceBaseline) {
    return {
      hoursUsed,
      hoursBetween,
      hoursAtLastService: 0,
      hoursSinceLastService: 0,
      hoursUntilService: hoursBetween,
      serviceProgress: 0,
      isOverdue: false,
      hasServiceBaseline: false,
    };
  }

  const hoursAtLastService = Math.max(0, num(equipment.hours_at_last_service));
  const hoursSinceLastService = Math.max(0, hoursUsed - hoursAtLastService);
  const isOverdue = hoursSinceLastService >= hoursBetween;
  const hoursUntilService = isOverdue
    ? 0
    : Math.max(0, hoursBetween - hoursSinceLastService);
  const serviceProgress = Math.min(
    100,
    Math.round((hoursSinceLastService / hoursBetween) * 100),
  );

  return {
    hoursUsed,
    hoursBetween,
    hoursAtLastService,
    hoursSinceLastService,
    hoursUntilService,
    serviceProgress,
    isOverdue,
    hasServiceBaseline: true,
  };
}
