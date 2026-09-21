export type RegistrationProfileFields = {
  first_name: string;
  middle_name: string | null;
  last_name: string;
  sex: string;
  civil_status: string;
  nationality: string;
  dob: string;
  phone: string;
  barangay: string;
  municipality: string;
  school_name: string;
  course: string;
  year_level: string;
  average_grade: number;
  student_id_number: string;
};

export function profileFromUserMetadata(
  meta: Record<string, unknown> | undefined | null
): Partial<RegistrationProfileFields> | null {
  if (!meta) return null;
  const first = typeof meta.first_name === "string" ? meta.first_name : "";
  const last = typeof meta.last_name === "string" ? meta.last_name : "";
  if (!first && !last) return null;

  const gradeRaw = meta.average_grade;
  const average_grade =
    typeof gradeRaw === "number"
      ? gradeRaw
      : typeof gradeRaw === "string" && gradeRaw.trim()
        ? parseFloat(gradeRaw)
        : undefined;

  return {
    first_name: first,
    middle_name: typeof meta.middle_name === "string" && meta.middle_name ? meta.middle_name : null,
    last_name: last,
    sex: typeof meta.sex === "string" ? meta.sex : undefined,
    civil_status: typeof meta.civil_status === "string" ? meta.civil_status : undefined,
    nationality: typeof meta.nationality === "string" ? meta.nationality : undefined,
    dob: typeof meta.dob === "string" ? meta.dob : undefined,
    phone: typeof meta.phone === "string" ? meta.phone : undefined,
    barangay: typeof meta.barangay === "string" ? meta.barangay : undefined,
    municipality: typeof meta.municipality === "string" ? meta.municipality : undefined,
    school_name: typeof meta.school_name === "string" ? meta.school_name : undefined,
    course: typeof meta.course === "string" ? meta.course : undefined,
    year_level: typeof meta.year_level === "string" ? meta.year_level : undefined,
    average_grade: Number.isFinite(average_grade) ? average_grade : undefined,
    student_id_number: typeof meta.student_id_number === "string" ? meta.student_id_number : undefined,
  };
}
