import type { Metadata } from "next";
import { ModelLab } from "@/features/model-lab/model-lab";

export const metadata: Metadata = {
  title: "Model Lab · Diamond Edge",
  description: "Walk-forward measurement — per-model Brier, log loss, MAE and calibration.",
};

export default function ModelLabPage() {
  return <ModelLab />;
}
