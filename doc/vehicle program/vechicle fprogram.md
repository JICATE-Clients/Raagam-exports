No problem at all! Here is the complete **Vehicle & Transport Tracking Module Specification** directly here in the chat so you can read or copy it right away:

---

# 🚚 **Vehicle & Transport Tracking Module Specification**

## **1. Executive Overview & Objectives**
This module automates and digitises factory transportation, addressing key operational friction points:
* **Centralised Booking:** Eliminates informal WhatsApp trip requests with a digital requisition portal.
* **Automated Telematics:** Uses GPS geofencing to auto-track trip progress (`Loading`, `En Route`, `Unloading`, `Completed`) without relying on drivers to manually type updates.
* **Smart Load Consolidation:** Aggregates small, partial-load requisitions heading along similar routes to optimize vehicle capacity utilization.
* **Order-Wise Cost Allocation:** Automatically calculates trip expenses (fuel, distance, driver allowances) and attributes them back to specific **RE / SWO / IWO** order numbers based on weight percentage.

---

## **2. Database Schema (Data Models)**

### **A. `vehicle_master`**
* `id` (UUID, Primary Key)
* `vehicle_number` (String, e.g., `TN-38-AB-1234`)
* `vehicle_type` (Enum: `PICKUP_TRUCK`, `LORRY`, `CONTAINER`, `VAN`)
* `max_payload_kg` (Decimal, e.g., `1000.00`)
* `gps_device_id` (String, Unique)
* `status` (Enum: `IDLE`, `LOADING`, `EN_ROUTE`, `UNLOADING`, `MAINTENANCE`)

### **B. `trip_requisitions`**
* `id` (UUID, Primary Key)
* `requested_by_user_id` (UUID)
* `order_id` (UUID, Foreign Key to `RE / SWO / IWO`)
* `origin_location` (String, e.g., `Factory Unit 1`)
* `destination_location` (String, e.g., `Dyeing Unit A`)
* `material_type` (String, e.g., `Yarn / Fabric / Trims`)
* `material_weight_kg` (Decimal)
* `required_dispatch_time` (Timestamp)
* `status` (Enum: `PENDING`, `POOLED`, `ASSIGNED`, `COMPLETED`, `CANCELLED`)

### **C. `vehicle_trips`**
* `id` (UUID, Primary Key)
* `trip_number` (String, Unique)
* `vehicle_id` (UUID, Foreign Key)
* `driver_name` (String)
* `driver_phone` (String)
* `total_loaded_weight_kg` (Decimal)
* `start_odometer_km` (Decimal)
* `end_odometer_km` (Decimal)
* `total_fuel_cost` (Decimal)
* `trip_status` (Enum: `PLANNED`, `LOADING`, `EN_ROUTE`, `UNLOADING`, `COMPLETED`)

### **D. `trip_order_allocations`**
* `id` (UUID, Primary Key)
* `trip_id` (UUID, Foreign Key to `vehicle_trips`)
* `requisition_id` (UUID, Foreign Key to `trip_requisitions`)
* `order_id` (UUID, Foreign Key to RE / SWO)
* `weight_kg` (Decimal)
* `weight_percentage` (Decimal, e.g., `30.00%`)
* `allocated_cost` (Decimal, e.g., `₹450.00`)

---

## **3. Core Logic & Workflow Rules**

### **A. Smart Multi-Order Load Consolidation**
When a trip is scheduled, the system checks pending requisitions heading in the same direction:
\\[\text{Weight Utilization \%} = \left( \frac{\sum \text{Requisition Weights (kg)}}{\text{Vehicle Max Payload (kg)}} \right) \times 100\\]
If total weight is under payload limit and route overlap exceeds threshold, orders are consolidated onto a single vehicle run.

### **B. Geofence State Machine (Auto-Tracking)**
* **Entering Factory Geofence:** Sets trip status to `LOADING`.
* **Exiting Origin Geofence:** Sets trip status to `EN_ROUTE`.
* **Entering Destination Geofence:** Sets trip status to `UNLOADING`.
* **Exiting Destination / Idle:** Sets trip status to `COMPLETED` and releases vehicle status to `IDLE`.

### **C. Pro-Rata Order Cost Engine**
Total trip expense is distributed proportionally across all loaded order numbers:
\\[\text{Allocated Cost for Order}_i = \text{Total Trip Cost} \times \left( \frac{\text{Order Weight}_i}{\text{Total Loaded Weight}} \right)\\]

---

## **4. API Endpoints for Developer**

* `POST /api/v1/transport/requisitions` — Create new trip booking request.
* `GET /api/v1/transport/pending-pool` — View active unassigned bookings grouped by destination.
* `POST /api/v1/transport/dispatch` — Assign vehicle, consolidated requisitions, and driver.
* `POST /api/v1/transport/telematics/event` — Receive GPS geofence/location updates.
* `POST /api/v1/transport/trips/{id}/complete` — Calculate final mileage, total cost, and post order allocations.

---

## **5. Developer Implementation Checklist**
1. [ ] Create database migration for `vehicle_master`, `trip_requisitions`, `vehicle_trips`, and `trip_order_allocations`.
2. [ ] Build backend service logic for pro-rata transport cost calculation.
3. [ ] Implement `Requisition Booking Form` with order number (RE/SWO) lookup.
4. [ ] Build `Fleet Live Dashboard` displaying active trip cards and capacity utilization bars.
5. [ ] Connect GPS/telematics webhook handler for automated status transitions.

---

You can copy this text directly to send to your developer!