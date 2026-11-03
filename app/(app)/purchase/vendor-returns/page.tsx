import { redirect } from "next/navigation";

/**
 * TWO SCREENS, NOT THREE (user 2026-11-02, the return plan): a GRN raises the Rejection /
 * Replacement DC, and Purchase ▸ Delivery Challans dispatches and prints it. This list, and
 * its hand-typed "New Return" form, are gone — the address opens the DC register on its
 * Rejection tab, so a saved link or the sidebar row still lands on the returns.
 */
export default function VendorReturnsMoved() {
  redirect("/purchase/dc?type=rejection");
}
