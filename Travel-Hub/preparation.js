import { days, localDate } from "./fields.js";

export const preparationStages = [
  { id: "early", label: "現在開始" },
  { id: "month", label: "出發前一個月" },
  { id: "week", label: "出發前一週" },
  { id: "eve", label: "出發前一天" },
];

export function currentStage(trip, now = new Date()) {
  const remaining = days(localDate(trip.timezone, now), trip.start);
  if (remaining <= 1) return 3;
  if (remaining <= 7) return 2;
  if (remaining <= 30) return 1;
  return 0;
}

export function duePreparation(trip, now = new Date()) {
  const current = currentStage(trip, now);
  return (trip.preparation || [])
    .filter(
      (task) =>
        !task.done &&
        preparationStages.findIndex((stage) => stage.id === task.stage) <=
          current,
    )
    .toSorted(
      (a, b) =>
        preparationStages.findIndex((stage) => stage.id === a.stage) -
        preparationStages.findIndex((stage) => stage.id === b.stage),
    );
}
