import { emptyCourse, placePiece, type Course } from './course';
import type { PartType } from './parts';

type Step = [type: PartType, q: number, r: number, rot?: number];

/** 下から順に積む手順。支柱を先に置き、その上に部品を置く */
const STEPS: Step[] = [
  ['support', -3, 0], ['support', -3, 0], ['support', -3, 0], ['start', -3, 0, 0],
  ['support', -2, 0], ['support', -2, 0], ['support', -2, 0], ['straight', -2, 0, 0],
  ['support', -1, 0], ['support', -1, 0], ['slope', -1, 0, 3],
  ['support', 0, 0], ['support', 0, 0], ['curve60', 0, 0, 1],
  ['support', 1, -1], ['splitter', 1, -1, 1], ['drop', 1, -1, 4],
  ['slope', 0, -1, 0], ['goal', -1, -1],
  ['slope', 1, 0, 2], ['goal', 1, 1],
];

export function buildCourse(steps: Step[]): Course {
  let course = emptyCourse();
  for (const [type, q, r, rot = 0] of steps) {
    const res = placePiece(course, type, q, r, rot);
    if (!res.ok) throw new Error(`${type} (${q},${r}): ${res.reason}`);
    course = res.course;
  }
  return course;
}

/** 初回起動時に表示するサンプルコース */
export function sampleCourse(): Course {
  return buildCourse(STEPS);
}
