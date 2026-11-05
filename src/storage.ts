import type { Course } from './core/course';
import { parseCourse, serializeCourse } from './core/serialize';

const KEY = 'hexmarble.course.v1';

export function saveToLocal(course: Course): void {
  localStorage.setItem(KEY, serializeCourse(course));
}

/** 保存がなければ null。壊れていれば Error を投げる */
export function loadFromLocal(): Course | null {
  const text = localStorage.getItem(KEY);
  return text === null ? null : parseCourse(text);
}

export function downloadJson(course: Course, filename = 'hexmarble-course.json'): void {
  const blob = new Blob([serializeCourse(course, 'HexMarble course')], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readJsonFile(file: File): Promise<Course> {
  return parseCourse(await file.text());
}
