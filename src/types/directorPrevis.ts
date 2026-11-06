/**
 * directorPrevis — 定义AI 镜头预演的场景、对象与摄影机的领域类型。
 */
import type { DirectorProjectFileReference } from './directorScene';

/** Y-up / right-handed / metres. This is a previs contract, not Blender Director Scene. */
export type PrevisVector = [number, number, number];
export type PrevisEasing = 'linear' | 'smooth';
export type PrevisPrimitive = 'box' | 'sphere' | 'cylinder' | 'cone' | 'plane' | 'character';

export interface PrevisObjectKeyframe {
  time: number;
  position: PrevisVector;
  rotation: PrevisVector;
}

export interface PrevisObject {
  id: string;
  name: string;
  primitive: PrevisPrimitive;
  position: PrevisVector;
  rotation: PrevisVector; // degrees
  size: PrevisVector; // dimensions; character position is its feet
  color: string;
  keyframes: PrevisObjectKeyframe[];
}

export interface PrevisCameraKeyframe {
  time: number;
  position: PrevisVector;
  target: PrevisVector;
  focalLength: number;
  roll: number; // degrees
}

export interface DirectorPrevisScene {
  schemaVersion: 1;
  title: string;
  duration: number;
  aspectRatio: '16:9' | '9:16' | '2.39:1';
  easing: PrevisEasing;
  background: string;
  groundColor: string;
  objects: PrevisObject[];
  camera: { keyframes: PrevisCameraKeyframe[] };
}

export type DirectorPrevisReference = DirectorProjectFileReference;
export type DirectorPrevisView = 'camera' | 'space' | 'top';
