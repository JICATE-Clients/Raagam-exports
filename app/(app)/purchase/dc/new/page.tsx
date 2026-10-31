import { redirect } from "next/navigation";

/** Retired 2026-10-31: a new DC is raised in the Delivery Challans hub's drawer. */
export default function NewDcPage() {
  redirect("/purchase/dc?new=process&type=process");
}
