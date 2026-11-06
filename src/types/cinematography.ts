/**
 * cinematography — 定义摄影器材、效果与镜头设置的领域类型。
 */
import type { CameraShutterEffect } from './index';

export type CinemaFormat = 's16' | 's35' | 'ff' | 'lf' | 'vv';
/** undefined 继承整表；null 明确不指定该项，不重新带入整表值。 */
export interface CinematographySettings {
  cameraId?: string | null;
  lensId?: string | null;
  recordingFormat?: CinemaFormat | null;
  focalLengthMm?: number | null;
  apertureT?: number | null;
  effectId?: string | null;
  depthOfField?: 'shallow' | 'balanced' | 'deep' | null;
  focus?: 'eyes' | 'foreground' | 'background' | 'rack' | null;
  focusDistanceM?: number | null;
  flare?: 'none' | 'subtle' | 'strong' | null;
  filmStockId?: string | null;
  grain?: 'none' | 'subtle' | 'visible' | null;
  shutterEffect?: CameraShutterEffect | null;
}

export interface CinemaCamera {
  id: string;
  name: string;
  capture: 'digital' | 'film';
  formats: readonly CinemaFormat[];
  mount: string;
  adapters: readonly string[];
  use: string;
  source: string;
}

export interface CinemaLens {
  id: string;
  name: string;
  coverage: 's16' | 's35' | 'ff';
  mounts: readonly string[];
  focalLengths: readonly number[];
  zoom?: readonly [number, number];
  minT?: number;
  minTByFocal?: Readonly<Record<number, number>>;
  squeeze?: number;
  flareColor?: 'blue' | 'amber' | 'silver';
  macro?: boolean;
  look?: string;
  use: string;
  source: string;
}

export interface CinemaEffect {
  id: string;
  name: string;
  use: string;
  prompt: string;
  settings: CinematographySettings;
}
