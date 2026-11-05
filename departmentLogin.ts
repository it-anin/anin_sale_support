import type { Profile } from "./auth";

export type DepartmentId = "sales" | "purchasing" | "warehouse";

export const LOGIN_DEPARTMENTS: readonly {
  id: DepartmentId;
  label: string;
  english: string;
  group: Profile["group"];
}[] = [
  { id: "sales", label: "แผนกขาย", english: "Sales", group: "สาขา" },
  {
    id: "purchasing",
    label: "แผนกจัดซื้อ",
    english: "Purchasing",
    group: "จัดซื้อ",
  },
  {
    id: "warehouse",
    label: "แผนกคลังสินค้า",
    english: "Warehouse",
    group: "คลังสินค้า",
  },
];

export function findDepartmentProfile(
  profiles: readonly Profile[],
  departmentId: DepartmentId,
  password: string,
): Profile | null {
  const department = LOGIN_DEPARTMENTS.find((item) => item.id === departmentId);
  if (!department || !password) return null;
  return (
    profiles.find(
      (profile) =>
        profile.group === department.group && profile.password === password,
    ) ?? null
  );
}

export function guidedPathKeyframes(dx: number, dy: number): Keyframe[] {
  const at = (x: number, y: number, offset: number): Keyframe => ({
    transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
    offset,
  });
  return [at(dx, dy, 0), at(0, dy, 0.46), at(0, 0, 1)];
}
