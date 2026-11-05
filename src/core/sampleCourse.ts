import { emptyCourse, placePiece, type Course } from './course';
import type { PartType } from './parts';

type Step = [type: PartType, q: number, r: number, rot?: number, level?: number];

/** 置く手順。level を省略するとセルの最上部に置く */
const STEPS: Step[] = [
  ['start', -3, 0, 0, 3],
  ['straight', -2, 0, 0, 3],
  ['slope', -1, 0, 3, 2],
  ['curve60', 0, 0, 1, 2],
  ['splitter', 1, -1, 1, 1],
  ['drop', 1, -1, 4, 2],
  ['slope', 0, -1, 0, 0],
  ['goal', -1, -1, 0, 0],
  ['slope', 1, 0, 2, 0],
  ['goal', 1, 1, 0, 0],
];

export function buildCourse(steps: Step[]): Course {
  let course = emptyCourse();
  for (const [type, q, r, rot = 0, level] of steps) {
    const res = placePiece(course, type, q, r, rot, level);
    if (!res.ok) throw new Error(`${type} (${q},${r}): ${res.reason}`);
    course = res.course;
  }
  return course;
}

/** 初回起動時に表示するサンプルコース */
export function sampleCourse(): Course {
  return buildCourse(STEPS);
}
