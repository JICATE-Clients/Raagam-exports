import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { findSubmodule, findSubChild } from "@/lib/masters/submodules";
import { PageHeader } from "@/components/ui/page-header";
import { listCountries } from "@/lib/masters/country-service";
import { CountryMasterScreen } from "@/components/masters/country-master-screen";
import { listDestinations } from "@/lib/masters/destination-service";
import { DestinationMasterScreen } from "@/components/masters/destination-master-screen";
import { listPorts } from "@/lib/masters/port-service";
import { PortMasterScreen } from "@/components/masters/port-master-screen";
import { listBanks } from "@/lib/masters/bank-service";
import { BankMasterScreen } from "@/components/masters/bank-master-screen";
import { listReceivableTerms } from "@/lib/masters/receivable-term-service";
import { ReceivableTermMasterScreen } from "@/components/masters/receivable-term-master-screen";
import { listPaymentTerms } from "@/lib/masters/payment-term-service";
import { PaymentTermMasterScreen } from "@/components/masters/payment-term-master-screen";
import { listApplicants } from "@/lib/masters/applicant-service";
import { listConfigLookups } from "@/lib/masters/extras-service";
import { listCurrencies } from "@/lib/masters/service";
import { ApplicantMasterScreen } from "@/components/masters/applicant-master-screen";
import { listCustomers } from "@/lib/masters/customer-service";
import { CustomerMasterScreen } from "@/components/masters/customer-master-screen";
import { getCourierOptions } from "@/lib/admin/extras-service";
import { getCompanyProfile } from "@/lib/admin/company-service";
import { listNotifies } from "@/lib/masters/notify-service";
import { NotifyMasterScreen } from "@/components/masters/notify-master-screen";
import { listEmployeeLocations, listEmployees } from "@/lib/masters/employee-service";
import { EmployeeMasterScreen } from "@/components/masters/employee-master-screen";
import { listWorkTimings } from "@/lib/masters/work-timing-service";
import { WorkTimingMasterScreen } from "@/components/masters/work-timing-master-screen";
import { listWorkingHours } from "@/lib/masters/working-hour-service";
import { WorkingHourMasterScreen } from "@/components/masters/working-hour-master-screen";
import { listDesignations } from "@/lib/masters/designation-service";
import { DesignationMasterScreen } from "@/components/masters/designation-master-screen";
import { listHsnDetails } from "@/lib/masters/hsn-detail-service";
import { HsnDetailMasterScreen } from "@/components/masters/hsn-detail-master-screen";
import { listEmployeeCategories } from "@/lib/masters/employee-category-service";
import { EmployeeCategoryMasterScreen } from "@/components/masters/employee-category-master-screen";
import { listConsignees } from "@/lib/masters/consignee-service";
import { ConsigneeMasterScreen } from "@/components/masters/consignee-master-screen";
import { listVendors, listVendorsForPicker } from "@/lib/masters/vendor-service";
import { VendorMasterScreen } from "@/components/masters/vendor-master-screen";
import { GstinCheckScreen } from "@/components/masters/gstin-check-screen";
import { listProcessHsn } from "@/lib/masters/process-hsn-service";
import { ProcessHsnAssignScreen } from "@/components/masters/process-hsn-assign-screen";
import { listMaterialHsn } from "@/lib/masters/material-hsn-service";
import { MaterialHsnAssignScreen } from "@/components/masters/material-hsn-assign-screen";
import { listCategories } from "@/lib/masters/category-service";
import { listLevies } from "@/lib/masters/levy-service";
import { listProcesses } from "@/lib/masters/process-service";
import { CurrencyMasterScreen } from "@/components/masters/currency-master-screen";
import { listExchangeRateEntries } from "@/lib/masters/exchange-rate-service";
import { ExchangeRateMasterScreen } from "@/components/masters/exchange-rate-master-screen";
import { listAllowances } from "@/lib/masters/allowance-service";
import { AllowanceMasterScreen } from "@/components/masters/allowance-master-screen";
import { listDeductions } from "@/lib/masters/deduction-service";
import { DeductionMasterScreen } from "@/components/masters/deduction-master-screen";
import { listHolidays } from "@/lib/masters/holiday-service";
import { HolidayMasterScreen } from "@/components/masters/holiday-master-screen";
import { listLeaveTypes } from "@/lib/masters/leave-type-service";
import { LeaveTypeMasterScreen } from "@/components/masters/leave-type-master-screen";
import { listStates } from "@/lib/masters/state-service";
import { StateMasterScreen } from "@/components/masters/state-master-screen";
import { listHostelCategories } from "@/lib/masters/hostel-category-service";
import { HostelCategoryMasterScreen } from "@/components/masters/hostel-category-master-screen";
import { listAdvanceLoanTypes } from "@/lib/masters/advance-loan-type-service";
import { AdvanceLoanTypeMasterScreen } from "@/components/masters/advance-loan-type-master-screen";
import { listDepartments } from "@/lib/masters/department-service";
import { listDivisions } from "@/lib/masters/division-service";
import { DepartmentMasterScreen } from "@/components/masters/department-master-screen";
import { listPfEsiControls } from "@/lib/masters/pf-esi-control-service";
import { PfEsiControlMasterScreen } from "@/components/masters/pf-esi-control-master-screen";
import { listOurBanks } from "@/lib/masters/our-bank-service";
import { OurBankMasterScreen } from "@/components/masters/our-bank-master-screen";
import { listZones } from "@/lib/masters/zone-service";
import { ZoneMasterScreen } from "@/components/masters/zone-master-screen";
import { listDocumentNoFormats } from "@/lib/masters/document-no-format-service";
import { DocumentNoFormatMasterScreen } from "@/components/masters/document-no-format-master-screen";
import { listPackingFormatColumns } from "@/lib/masters/packing-format-columns-service";
/**
 * `departmentsAsLookups` / `designationsAsLookups` ARE DELIBERATELY NOT IMPORTED
 * HERE (2026-08-31). Every `department_id` / `designation_id` column in this
 * schema is `references public.config_lookups(id)`, so these four party screens
 * feed those pickers from `all.filter(l => l.kind === …)` instead. See the note
 * on the `employee` branch below, and the warning on the shims themselves.
 *
 * `statesAsLookups` and `paymentTermsAsLookups` are the opposite case and must
 * STAY — 0355 and 0375 repointed those FKs at the dedicated masters, so feeding
 * them from `config_lookups` would be the same bug mirrored.
 */
import {
  paymentTermsAsLookups,
  statesAsLookups,
  hsnDetailsAsLookups,
  categoriesAsLookups,
} from "@/lib/masters/lookup-compat";
import { isInactive } from "@/lib/masters/inactive";

export default async function SubEntityPage({
  params,
}: {
  params: Promise<{ submodule: string; entity: string }>;
}) {
  await requirePermission("masters", "view");
  const { submodule, entity } = await params;
  const sub = findSubmodule(submodule);
  if (!sub || sub.slug === "materials") notFound();
  const child = findSubChild(sub, entity);
  if (!child) notFound();
  if (child.type === "link") redirect(child.href); // owned elsewhere / legacy editor

  let screen: React.ReactNode = null;
  if (child.type === "custom") {
    const [canCreate, canEdit, canDelete] = await Promise.all([
      can("masters", "create"),
      can("masters", "edit"),
      can("masters", "delete"),
    ]);
    const perms = { canCreate, canEdit, canDelete };
    if (child.custom === "country") {
      const countries = await listCountries();
      screen = <CountryMasterScreen rows={countries} perms={perms} />;
    } else if (child.custom === "currency") {
      const currencies = await listCurrencies();
      screen = <CurrencyMasterScreen rows={currencies} perms={perms} />;
    } else if (
      child.custom === "exchange_rate_quotes_orders" ||
      child.custom === "exchange_rate_customs" ||
      child.custom === "exchange_rate_imports"
    ) {
      const register =
        child.custom === "exchange_rate_customs"
          ? "customs"
          : child.custom === "exchange_rate_imports"
            ? "imports"
            : "quotes_orders";
      const [entries, currencies] = await Promise.all([
        listExchangeRateEntries(register),
        listCurrencies(),
      ]);
      screen = (
        <ExchangeRateMasterScreen
          rows={entries}
          register={register}
          currencies={currencies}
          perms={perms}
        />
      );
    } else if (child.custom === "department") {
      const [departments, departmentLocations, divisionRows] = await Promise.all([
        listDepartments(),
        listEmployeeLocations(),
        listDivisions(),
      ]);
      screen = (
        <DepartmentMasterScreen
          rows={departments}
          locations={departmentLocations}
          divisions={divisionRows.map((d) => ({ id: d.id, division_id: d.division_id ?? "", division_name: d.division_name ?? "" }))}
          perms={perms}
        />
      );
    } else if (child.custom === "pf_esi_control") {
      const controls = await listPfEsiControls();
      screen = <PfEsiControlMasterScreen rows={controls} perms={perms} />;
    } else if (child.custom === "destination") {
      const [destinations, countries] = await Promise.all([listDestinations(), listCountries()]);
      screen = <DestinationMasterScreen rows={destinations} countries={countries} perms={perms} />;
    } else if (child.custom === "port") {
      const [ports, countries] = await Promise.all([listPorts(), listCountries()]);
      screen = <PortMasterScreen rows={ports} countries={countries} perms={perms} />;
    } else if (child.custom === "bank") {
      const [banks, countries] = await Promise.all([listBanks(), listCountries()]);
      screen = <BankMasterScreen rows={banks} countries={countries} perms={perms} />;
    } else if (child.custom === "receivable_term") {
      const terms = await listReceivableTerms();
      screen = <ReceivableTermMasterScreen rows={terms} perms={perms} />;
    } else if (child.custom === "payment_term") {
      const terms = await listPaymentTerms();
      screen = <PaymentTermMasterScreen rows={terms} perms={perms} />;
    } else if (child.custom === "applicant") {
      const [applicants, countries, all, currencies, banks, stateRows, ptRows] = await Promise.all([
        listApplicants(),
        listCountries(),
        listConfigLookups(),
        listCurrencies(),
        listBanks(),
        listStates(),
        listPaymentTerms(),
      ]);
      screen = (
        <ApplicantMasterScreen
          rows={applicants}
          countries={countries}
          cities={all.filter((l) => l.kind === "city")}
          states={statesAsLookups(stateRows)}
          departments={all.filter((l) => l.kind === "department")}
          designations={all.filter((l) => l.kind === "designation")}
          internalDepartments={all.filter((l) => l.kind === "internal_department")}
          currencies={currencies}
          banks={banks}
          shipTypes={all.filter((l) => l.kind === "ship_type")}
          paymentTerms={paymentTermsAsLookups(ptRows)}
          perms={perms}
        />
      );
    } else if (child.custom === "customer") {
      const [
        customers,
        applicants,
        countries,
        all,
        currencies,
        vendors,
        couriers,
        terms,
        portRows,
        destRows,
        stateRows,
        company,
        catRows,
      ] = await Promise.all([
        listCustomers(),
        listApplicants(),
        listCountries(),
        listConfigLookups(),
        listCurrencies(),
        // The Vendor MASTER (`master_vendors`), not `getVendorsForPicker()` —
        // that reads the purchase-side `public.vendors`, so this dropdown used
        // to offer the demo seed while every vendor the operator had actually
        // created was absent. See 0376 and `listVendorsForPicker`.
        listVendorsForPicker(),
        getCourierOptions(),
        listReceivableTerms(),
        listPorts(),
        listDestinations(),
        listStates(),
        // Our own GSTIN — the reference point for classifying the customer's
        // GSTIN as within-state or other-state, i.e. IGST vs CGST+SGST. Same
        // source the Vendor branch below already uses; null is fine (the strip
        // just omits the supply fact).
        getCompanyProfile(),
        // The real Category master, for Supplied Items. NOT the two
        // `config_lookups` rows of kind 'material_category' — those are the
        // GROUP names ("Sewing Accessory", "Packing Accessory"), not the
        // categories inside them, which is what both cards used to offer
        // (client 2026-07-29, migration 0356).
        listCategories(),
      ]);
      // Supplied Items has one card per accessory group, so each needs the
      // categories of ITS OWN item class — a category only means anything
      // inside one. Resolved by class CODE rather than by name so a renamed
      // class does not silently empty a card.
      const sewClassId = all.find((l) => l.kind === "item_class" && (l.code ?? "").toUpperCase() === "SEW")?.id ?? null;
      const packClassId = all.find((l) => l.kind === "item_class" && (l.code ?? "").toUpperCase() === "PACK")?.id ?? null;
      const sewingCategories = categoriesAsLookups(catRows.filter((c) => c.item_class_id === sewClassId && !c.inactive));
      const packingCategories = categoriesAsLookups(catRows.filter((c) => c.item_class_id === packClassId && !c.inactive));
      // Fetch packing column configs for all formats in use
      const formatIds = [...new Set(customers.map((c) => c.packing_list_format_id).filter(Boolean))] as string[];
      const packingColumns = (await Promise.all(formatIds.map((fid) => listPackingFormatColumns(fid)))).flat();
      screen = (
        // The four `RecordPicker` lists below flatten a master to {id, code,
        // name}. The disable flag has to ride along or the picker cannot hide a
        // retired row; `public.ports` is the one exception, having no such column.
        <CustomerMasterScreen
          rows={customers}
          applicants={applicants}
          countries={countries}
          cities={all.filter((l) => l.kind === "city")}
          states={statesAsLookups(stateRows)}
          departments={all.filter((l) => l.kind === "department")}
          designations={all.filter((l) => l.kind === "designation")}
          internalDepartments={all.filter((l) => l.kind === "internal_department")}
          companyGstin={company?.gstin ?? null}
          currencies={currencies}
          shipTypes={all.filter((l) => l.kind === "ship_type")}
          sewingCategories={sewingCategories}
          packingCategories={packingCategories}
          agentTypes={all.filter((l) => l.kind === "agent_type")}
          agentOptions={all.filter((l) => l.kind === "agent")}
          packingFormats={all.filter((l) => l.kind === "packing_list_format")}
          commercialFormats={all.filter((l) => l.kind === "commercial_invoice_format")}
          vendors={vendors.map((v) => ({
            id: v.id,
            code: v.code,
            name: v.name,
            inactive: isInactive(v),
          }))}
          receivableTerms={terms.map((t) => ({
            id: t.id,
            code: String(t.entry_no),
            name: t.description ?? `Term #${t.entry_no}`,
            inactive: isInactive(t),
          }))}
          ports={portRows.map((p) => ({
            id: p.id,
            code: p.short_name,
            name: p.name ?? p.short_name ?? "—",
          }))}
          destinations={destRows.map((d) => ({
            id: d.id,
            code: d.short_name,
            name: d.name ?? d.short_name ?? "—",
            inactive: isInactive(d),
          }))}
          couriers={couriers.map((c) => ({
            id: c.id,
            code: c.code,
            name: c.name,
            inactive: isInactive(c),
          }))}
          packingColumns={packingColumns}
          perms={perms}
        />
      );
    } else if (child.custom === "work_timing") {
      const [timings, locations, all] = await Promise.all([
        listWorkTimings(),
        listEmployeeLocations(),
        listConfigLookups(),
      ]);
      screen = (
        <WorkTimingMasterScreen
          rows={timings}
          locations={locations}
          shiftCategories={all.filter((l) => l.kind === "shift_category")}
          perms={perms}
        />
      );
    } else if (child.custom === "working_hour") {
      const hours = await listWorkingHours();
      screen = <WorkingHourMasterScreen rows={hours} perms={perms} />;
    } else if (child.custom === "designation") {
      const designations = await listDesignations();
      screen = <DesignationMasterScreen rows={designations} perms={perms} />;
    } else if (child.custom === "hsn_detail") {
      const [hsnDetails, all] = await Promise.all([listHsnDetails(), listConfigLookups()]);
      screen = (
        <HsnDetailMasterScreen
          rows={hsnDetails}
          itemClasses={all.filter((l) => l.kind === "item_class")}
          perms={perms}
        />
      );
    } else if (child.custom === "employee") {
      /**
       * RESTORED 2026-08-31 — and NOT a copy of the branch that was removed on
       * 08-01, because that one would have rejected every save.
       *
       * ## ALL FOUR LOOKUPS COME FROM `config_lookups`. THE OLD BRANCH FED
       * ## THREE OF THEM FROM THE DEDICATED MASTERS INSTEAD.
       *
       * It passed `categories={employeeCategoriesAsLookups(ecRows)}`,
       * `departments={departmentsAsLookups(deptRows)}` and
       * `designations={designationsAsLookups(desigRows)}` — rows of
       * `public.employee_categories` / `departments` / `designations`, dressed
       * in ConfigLookup clothing by `lookup-compat.ts`. But 0243 declares all
       * four columns as `references public.config_lookups(id)`, so picking any
       * of those three wrote a uuid from the wrong table and the insert failed
       * on the FK. Only `teams` was right.
       *
       * `LookupDialogPicker` — which is what the screen renders for all four —
       * says so in its own comments: *"if the field's options come from
       * lookup-compat.ts rather than config_lookups, this component is the
       * wrong one"*, because its inline Add CREATES a `config_lookups` row.
       * The old branch handed it options from one table and let it write to
       * another.
       *
       * This is the `lookup-compat` FK-mismatch class — the same shape as the
       * `state` (0355) and `payment_term` (0375) landmines, where a same-named
       * column pointed at a different target. Diff the FK TARGET, never the
       * column name or the master's label; "the Designation master" names two
       * different tables in this codebase.
       *
       * It also means the historical branch is NOT a safe template even though
       * it is the best record of the intended slug and sub-module. Restoring it
       * verbatim would have reinstated a broken screen and, this time, one that
       * an operator actually reaches.
       *
       * ## AND IT IS WHAT MAKES 0482 PAY OFF
       *
       * 0482 seeds MERCHANDISER into `config_lookups` with `kind='designation'`
       * — exactly the list this feeds the Designation picker from. So the row
       * that migration adds is the row this screen offers, and tagging an
       * employee with it satisfies `getMerchandiserRows()`, which joins
       * `employees.designation_id`/`department_id` against the same table.
       * Feeding this picker from `public.designations` instead would have left
       * 0482's row unreachable and the Merchandiser dropdown empty with no
       * error anywhere.
       */
      const [employees, all, locations] = await Promise.all([
        listEmployees(),
        listConfigLookups(),
        listEmployeeLocations(),
      ]);
      screen = (
        <EmployeeMasterScreen
          rows={employees}
          categories={all.filter((l) => l.kind === "employee_category")}
          departments={all.filter((l) => l.kind === "department")}
          designations={all.filter((l) => l.kind === "designation")}
          teams={all.filter((l) => l.kind === "team")}
          locations={locations}
          perms={perms}
        />
      );
    } else if (child.custom === "employee_category") {
      const employeeCategories = await listEmployeeCategories();
      screen = <EmployeeCategoryMasterScreen rows={employeeCategories} perms={perms} />;
    } else if (child.custom === "notify") {
      const [notifies, countries, all, stateRows] = await Promise.all([
        listNotifies(),
        listCountries(),
        listConfigLookups(),
        listStates(),
      ]);
      screen = (
        <NotifyMasterScreen
          rows={notifies}
          countries={countries}
          cities={all.filter((l) => l.kind === "city")}
          states={statesAsLookups(stateRows)}
          departments={all.filter((l) => l.kind === "department")}
          designations={all.filter((l) => l.kind === "designation")}
          internalDepartments={all.filter((l) => l.kind === "internal_department")}
          perms={perms}
        />
      );
    } else if (child.custom === "consignee") {
      const [consignees, countries, all, customers, currencies, banks, notifies, stateRows, ptRows, company] = await Promise.all([
        listConsignees(),
        listCountries(),
        listConfigLookups(),
        listCustomers(),
        listCurrencies(),
        listBanks(),
        listNotifies(),
        listStates(),
        listPaymentTerms(),
        // Our own GSTIN — see the Customer and Vendor branches. Drives the
        // within-state / other-state fact on the GSTIN strip.
        getCompanyProfile(),
      ]);
      screen = (
        <ConsigneeMasterScreen
          rows={consignees}
          countries={countries}
          cities={all.filter((l) => l.kind === "city")}
          states={statesAsLookups(stateRows)}
          departments={all.filter((l) => l.kind === "department")}
          designations={all.filter((l) => l.kind === "designation")}
          internalDepartments={all.filter((l) => l.kind === "internal_department")}
          customers={customers}
          currencies={currencies}
          banks={banks}
          shipTypes={all.filter((l) => l.kind === "ship_type")}
          paymentTerms={paymentTermsAsLookups(ptRows)}
          notifies={notifies}
          companyGstin={company?.gstin ?? null}
          perms={perms}
        />
      );
    } else if (child.custom === "vendor") {
      const [
        vendors,
        countries,
        all,
        stateRows,
        company,
        categories,
        levies,
        ptRows,
        processRows,
      ] = await Promise.all([
          listVendors(),
          listCountries(),
          listConfigLookups(),
          listStates(),
          // Our own GSTIN — the reference point for classifying a vendor's GSTIN
          // as within-state or other-state. Null is fine (the strip just omits it).
          getCompanyProfile(),
          // Item Category tab (0369) — the real Category master (scoped per row
          // by Item Class), the Levy master (split into VAT and Duty by `type`)
          // and Payment Terms.
          listCategories(),
          listLevies(),
          listPaymentTerms(),
          // Process + SubContractor tabs (0370 / 0372) — the same Process master
          // feeds both grids.
          listProcesses(),
        ]);
      screen = (
        <VendorMasterScreen
          rows={vendors}
          countries={countries}
          cities={all.filter((l) => l.kind === "city")}
          states={statesAsLookups(stateRows)}
          groups={all.filter((l) => l.kind === "vendor_group")}
          companyGstin={company?.gstin ?? null}
          itemClasses={all.filter((l) => l.kind === "item_class")}
          categories={categories}
          levies={levies}
          paymentTerms={paymentTermsAsLookups(ptRows)}
          itemForms={all.filter((l) => l.kind === "vendor_item_form")}
          supplyTypes={all.filter((l) => l.kind === "vendor_supply_type")}
          processes={processRows}
          serviceTypes={all.filter((l) => l.kind === "vendor_service_type")}
          perms={perms}
        />
      );
    } else if (child.custom === "gstin_check") {
      // Read-only test bench — no perms beyond the module's own view gate, and
      // no save path at all. It needs the State master only so it can show WHICH
      // row a state code resolves to.
      const [stateRows, company] = await Promise.all([listStates(), getCompanyProfile()]);
      screen = (
        <GstinCheckScreen states={statesAsLookups(stateRows)} companyGstin={company?.gstin ?? null} />
      );
    } else if (child.custom === "allowance") {
      const allowances = await listAllowances();
      screen = <AllowanceMasterScreen rows={allowances} perms={perms} />;
    } else if (child.custom === "deduction") {
      const deductions = await listDeductions();
      screen = <DeductionMasterScreen rows={deductions} perms={perms} />;
    } else if (child.custom === "holiday") {
      const holidays = await listHolidays();
      screen = <HolidayMasterScreen rows={holidays} perms={perms} />;
    } else if (child.custom === "leave_type") {
      const leaveTypes = await listLeaveTypes();
      screen = <LeaveTypeMasterScreen rows={leaveTypes} perms={perms} />;
    } else if (child.custom === "gst_state") {
      const states = await listStates();
      screen = <StateMasterScreen rows={states} perms={perms} />;
    } else if (child.custom === "hsn_assign_material") {
      const [rows, all, cats, hsnRows] = await Promise.all([
        listMaterialHsn(),
        listConfigLookups(),
        listCategories(),
        listHsnDetails(),
      ]);
      screen = (
        <MaterialHsnAssignScreen
          rows={rows}
          hsnOptions={hsnDetailsAsLookups(hsnRows)}
          itemClasses={all.filter((l) => l.kind === "item_class")}
          categories={cats}
          perms={perms}
        />
      );
    } else if (child.custom === "hsn_assign_process") {
      const [rows, hsnRows] = await Promise.all([listProcessHsn(), listHsnDetails()]);
      screen = (
        <ProcessHsnAssignScreen
          rows={rows}
          hsnOptions={hsnDetailsAsLookups(hsnRows)}
          perms={perms}
        />
      );
    } else if (child.custom === "hostel_category") {
      const rows = await listHostelCategories();
      screen = <HostelCategoryMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "advance_loan_type") {
      const rows = await listAdvanceLoanTypes();
      screen = <AdvanceLoanTypeMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "our_bank") {
      const rows = await listOurBanks();
      screen = <OurBankMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "zone") {
      const rows = await listZones();
      screen = <ZoneMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "document_no_format") {
      const [formats, all] = await Promise.all([listDocumentNoFormats(), listConfigLookups()]);
      screen = (
        <DocumentNoFormatMasterScreen
          rows={formats}
          trackOptions={all.filter((l) => l.kind === "doc_track")}
          menuOptions={all.filter((l) => l.kind === "doc_menu")}
          valueTypeOptions={all.filter((l) => l.kind === "doc_value_type")}
          valueFromOptions={all.filter((l) => l.kind === "doc_value_from")}
          perms={perms}
        />
      );
    }
  }

  return (
    <div className="space-y-4">
      <nav className="text-xs text-muted-foreground">
        <Link href="/masters" className="hover:text-primary">
          Master Data
        </Link>{" "}
        /{" "}
        <Link href={`/masters/${sub.slug}`} className="hover:text-primary">
          {sub.label}
        </Link>{" "}
        / <span className="text-foreground">{child.label}</span>
      </nav>
      <PageHeader
        title={child.label}
        description={child.description}
        actions={
          <Link
            href={`/masters/${sub.slug}`}
            className="text-sm text-muted-foreground hover:text-primary"
          >
            ← {sub.label}
          </Link>
        }
      />
      {screen ?? (
        // Not-yet-built placeholder for `todo` children.
        <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-16 text-center">
          <p className="text-sm font-semibold text-foreground">Not built yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            The {child.singular} master is planned but not yet available.
            {sub.note ? ` ${sub.note}` : ""}
          </p>
        </div>
      )}
    </div>
  );
}
