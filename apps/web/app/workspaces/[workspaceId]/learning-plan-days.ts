export function learningPlanDays<T extends { day: number }>(days: number, objectives: T[]) {
  const groups = new Map<number, { objective: T; index: number }[]>()
  for (let day = 1; day <= days; day++) groups.set(day, [])
  objectives.forEach((objective, index) => {
    const group = groups.get(objective.day)
    const entry = { objective, index }
    if (group) group.push(entry)
    else groups.set(objective.day, [entry])
  })
  return [...groups].sort(([a], [b]) => a - b)
}
