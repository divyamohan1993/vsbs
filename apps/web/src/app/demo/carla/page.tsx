// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one
import type { Metadata } from "next";
import { CarlaDemo } from "./CarlaDemo";

export const metadata: Metadata = {
  title: "VSBS x CARLA — autonomous service loop",
  description: "Live demo of the failure-to-booking-to-drive-to-service-to-return loop.",
};

export default function CarlaDemoPage(): React.JSX.Element {
  return <CarlaDemo initialVehicleId="demo-veh-1" />;
}
