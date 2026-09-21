import { YEAR_LEVELS } from "@/lib/scholarships";

// Schools, strands and courses offered to students. One list, used by registration and the profile,
// so a value chosen in one place always exists in the other.

export { YEAR_LEVELS };
export type Option = { value: string; label: string };

export const SHS_LEVELS = ["Grade 11", "Grade 12"];
export const COLLEGE_LEVELS = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
export const isSHS = (level: string | null | undefined) => SHS_LEVELS.includes(level ?? "");
export const isCollege = (level: string | null | undefined) => COLLEGE_LEVELS.includes(level ?? "");

export const YEAR_LEVEL_OPTIONS: Option[] = [
  { value: "Grade 11", label: "Grade 11 (SHS)" },
  { value: "Grade 12", label: "Grade 12 (SHS)" },
  { value: "1st Year", label: "1st Year (College)" },
  { value: "2nd Year", label: "2nd Year (College)" },
  { value: "3rd Year", label: "3rd Year (College)" },
  { value: "4th Year", label: "4th Year (College)" },
];

export const SHS_SCHOOLS: Option[] = [
  { value: "San Jose National High School", label: "San Jose National High School" },
  { value: "San Jose National Agricultural & Industrial High School", label: "San Jose National Agricultural & Industrial High School" },
  { value: "Divine Word College of San Jose (SHS)", label: "Divine Word College of San Jose" },
  { value: "Pedro T. Mendiola Sr. Memorial National High School", label: "Pedro T. Mendiola Sr. Memorial National High School" },
  { value: "Mangarin National High School", label: "Mangarin National High School" },
  { value: "Central National High School", label: "Central National High School" },
  { value: "301600 Central National High School", label: "301600 Central National High School" },
  { value: "San Agustin High School", label: "San Agustin High School" },
  { value: "Caminawit National High School", label: "Caminawit National High School" },
  { value: "Iling National High School", label: "Iling National High School" },
  { value: "Iling National High School – Pawican Annex", label: "Iling National High School – Pawican Annex" },
  { value: "Holy Family Academy of Central", label: "Holy Family Academy of Central" },
  { value: "San Jose Adventist Academy Inc.", label: "San Jose Adventist Academy Inc." },
];

export const COLLEGE_SCHOOLS: Option[] = [
  { value: "Occidental Mindoro State University - Main Campus", label: "Occidental Mindoro State University – Main Campus" },
  { value: "Occidental Mindoro State University - San Jose Campus", label: "Occidental Mindoro State University – San Jose Campus" },
  { value: "Occidental Mindoro State University - Murtha Lower Campus", label: "Occidental Mindoro State University – Murtha Lower Campus" },
  { value: "Occidental Mindoro State University - Murtha Campus", label: "Occidental Mindoro State University – Murtha Campus" },
  { value: "Divine Word College of San Jose", label: "Divine Word College of San Jose" },
  { value: "Philippine Central Islands College", label: "Philippine Central Islands College" },
  { value: "Occidental Mindoro National College", label: "Occidental Mindoro National College" },
  { value: "CAPT. LAWRENCE A. COOPER TECHNICAL COLLEGE", label: "CAPT. LAWRENCE A. COOPER TECHNICAL COLLEGE" },
  { value: "Saint Joseph College Seminary", label: "Saint Joseph College Seminary" },
];

export const SHS_STRANDS: Option[] = [
  { value: "STEM", label: "Science, Technology, Engineering and Mathematics (STEM)" },
  { value: "ABM", label: "Accountancy, Business and Management (ABM)" },
  { value: "HUMSS", label: "Humanities and Social Sciences (HUMSS)" },
  { value: "GAS", label: "General Academic Strand (GAS)" },
  { value: "TVL", label: "Technical-Vocational-Livelihood (TVL)" },
];

const OMSU_MAIN: Option[] = [
  { value: "BSIT", label: "BS Information Technology (BSIT)" },
  { value: "BSCS", label: "BS Computer Science" },
  { value: "BSAg", label: "BS Agriculture" },
  { value: "BSAgTech", label: "BS Agricultural Technology" },
  { value: "BSAgroforestry", label: "BS Agroforestry" },
  { value: "BSCrim", label: "BS Criminology" },
  { value: "BSHM", label: "BS Hospitality Management" },
  { value: "BSTM", label: "BS Tourism Management" },
  { value: "BSBA", label: "BS Business Administration" },
  { value: "BSEntrepreneurship", label: "BS Entrepreneurship" },
  { value: "BEEd", label: "Bachelor of Elementary Education (BEEd)" },
  { value: "BSEd", label: "Bachelor of Secondary Education (BSEd)" },
  { value: "BPE", label: "Bachelor of Physical Education" },
  { value: "BSF", label: "BS Fisheries" },
];
const MURTHA: Option[] = [
  { value: "BSAg", label: "BS Agriculture" },
  { value: "BSAgTech", label: "BS Agricultural Technology" },
  { value: "BSAgroforestry", label: "BS Agroforestry" },
  { value: "BSAgribusiness", label: "Agribusiness Management" },
  { value: "BSAnimalSci", label: "Animal Science" },
  { value: "BSCropSci", label: "Crop Science" },
];

export const COURSES_BY_SCHOOL: Record<string, Option[]> = {
  "Occidental Mindoro State University - Main Campus": [
    ...OMSU_MAIN,
    { value: "BSN", label: "BS Nursing" },
    { value: "BSM", label: "BS Midwifery" },
    { value: "BSSA", label: "BS Social Work" },
  ],
  "Occidental Mindoro State University - San Jose Campus": [
    ...OMSU_MAIN,
    { value: "TESDA-Automotive", label: "TESDA – Automotive Servicing" },
    { value: "TESDA-Welding", label: "TESDA – Welding Technology" },
    { value: "TESDA-Electrical", label: "TESDA – Electrical Technology" },
    { value: "TESDA-FoodService", label: "TESDA – Food Service Management" },
  ],
  "Occidental Mindoro State University - Murtha Lower Campus": MURTHA,
  "Occidental Mindoro State University - Murtha Campus": MURTHA,
  "Divine Word College of San Jose": [
    { value: "BSN", label: "BS Nursing" },
    { value: "BSIT", label: "BS Information Technology" },
    { value: "BSBA", label: "BS Business Administration" },
    { value: "BSCrim", label: "BS Criminology" },
    { value: "BSHM", label: "BS Hospitality Management" },
    { value: "BSTM", label: "BS Tourism Management" },
    { value: "BEEd", label: "Bachelor of Elementary Education (BEEd)" },
    { value: "BSEd", label: "Bachelor of Secondary Education (BSEd)" },
  ],
  "Philippine Central Islands College": [
    { value: "BSCrim", label: "BS Criminology" },
    { value: "BSBA", label: "BS Business Administration" },
    { value: "BSIT", label: "BS Information Technology" },
    { value: "BSHM", label: "BS Hospitality Management" },
    { value: "BEEd", label: "Education Programs" },
    { value: "TESDA-PICOL", label: "TESDA Courses" },
  ],
  "Occidental Mindoro National College": [
    { value: "BSBA-OMNC", label: "Business Courses" },
    { value: "BEEd-OMNC", label: "Education Courses" },
    { value: "BSIT-OMNC", label: "Computer-related Programs" },
    { value: "TVL-OMNC", label: "Technical-Vocational Courses" },
  ],
  "CAPT. LAWRENCE A. COOPER TECHNICAL COLLEGE": [
    { value: "BSIT-Cooper", label: "BS Information Technology" },
    { value: "BSEE-Cooper", label: "BS Electrical Engineering Technology" },
    { value: "BSME-Cooper", label: "BS Mechanical Engineering Technology" },
    { value: "TESDA-Cooper", label: "TESDA Technical Programs" },
  ],
  "Saint Joseph College Seminary": [
    { value: "AB-Philosophy", label: "AB Philosophy" },
    { value: "AB-Theology", label: "AB Theology" },
    { value: "BEEd-Seminary", label: "Bachelor of Elementary Education" },
  ],
};

export const schoolsFor = (level: string | null | undefined): Option[] =>
  isSHS(level) ? SHS_SCHOOLS : isCollege(level) ? COLLEGE_SCHOOLS : [];

export const coursesFor = (level: string | null | undefined, school: string | null | undefined): Option[] =>
  isSHS(level) ? SHS_STRANDS : COURSES_BY_SCHOOL[school ?? ""] ?? [];

/** Options plus the current value if it isn't in the list (old data), so it isn't silently lost. */
export const withCurrent = (options: Option[], current: string | null | undefined): Option[] =>
  current && !options.some((o) => o.value === current) ? [...options, { value: current, label: `${current} (current)` }] : options;
