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
import { getVendorsForPicker } from "@/lib/purchase/po-service";
import { getCourierOptions } from "@/lib/admin/extras-service";
import { listNotifies } from "@/lib/masters/notify-service";
import { NotifyMasterScreen } from "@/components/masters/notify-master-screen";
import { listEmployees, listEmployeeLocations } from "@/lib/masters/employee-service";
import { EmployeeMasterScreen } from "@/components/masters/employee-master-screen";
import { listMerchandisingTeams } from "@/lib/masters/merchandising-team-service";
import { MerchandisingTeamMasterScreen } from "@/components/masters/merchandising-team-master-screen";
import { listWorkTimings } from "@/lib/masters/work-timing-service";
import { WorkTimingMasterScreen } from "@/components/masters/work-timing-master-screen";
import { listWorkingHours } from "@/lib/masters/working-hour-service";
import { WorkingHourMasterScreen } from "@/components/masters/working-hour-master-screen";
import { listDesignations } from "@/lib/masters/designation-service";
import { DesignationMasterScreen } from "@/components/masters/designation-master-screen";
import { listHsnDetails } from "@/lib/masters/hsn-detail-service";
import { HsnDetailMasterScreen } from "@/components/masters/hsn-detail-master-screen";
import { listDocumentNoFormats } from "@/lib/masters/document-no-format-service";
import { DocumentNoFormatMasterScreen } from "@/components/masters/document-no-format-master-screen";
import { listEmployeeCategories } from "@/lib/masters/employee-category-service";
import { EmployeeCategoryMasterScreen } from "@/components/masters/employee-category-master-screen";
import { listAccountGroups } from "@/lib/masters/account-group-service";
import { AccountGroupMasterScreen } from "@/components/masters/account-group-master-screen";
import { listConsignees } from "@/lib/masters/consignee-service";
import { ConsigneeMasterScreen } from "@/components/masters/consignee-master-screen";
import { listVendors } from "@/lib/masters/vendor-service";
import { VendorMasterScreen } from "@/components/masters/vendor-master-screen";
import { listAccountHeads } from "@/lib/masters/account-head-service";
import { AccountHeadMasterScreen } from "@/components/masters/account-head-master-screen";
import { getCostHeads } from "@/lib/finance/cost-heads/service";
import { listCourierDeliveryAddresses } from "@/lib/masters/courier-delivery-service";
import { CourierDeliveryAddressMasterScreen } from "@/components/masters/courier-delivery-master-screen";
import { listCustomerTcs } from "@/lib/masters/tcs-service";
import { TcsAssignScreen } from "@/components/masters/tcs-assign-screen";
import { listVendorGst } from "@/lib/masters/vendor-gst-service";
import { GstAssignScreen } from "@/components/masters/gst-assign-screen";
import { listCustomerGst } from "@/lib/masters/customer-gst-service";
import { CustomerGstAssignScreen } from "@/components/masters/customer-gst-assign-screen";
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
import { listGarmentRejectionRules } from "@/lib/masters/garment-rejection-rule-service";
import { GarmentRejectionRuleMasterScreen } from "@/components/masters/garment-rejection-rule-master-screen";
import { listHostelCategories } from "@/lib/masters/hostel-category-service";
import { HostelCategoryMasterScreen } from "@/components/masters/hostel-category-master-screen";
import { listAdvanceLoanTypes } from "@/lib/masters/advance-loan-type-service";
import { AdvanceLoanTypeMasterScreen } from "@/components/masters/advance-loan-type-master-screen";
import { listDepartments } from "@/lib/masters/department-service";
import { DepartmentMasterScreen } from "@/components/masters/department-master-screen";
import { listPfEsiControls } from "@/lib/masters/pf-esi-control-service";
import { PfEsiControlMasterScreen } from "@/components/masters/pf-esi-control-master-screen";

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
      const [departments, departmentLocations] = await Promise.all([
        listDepartments(),
        listEmployeeLocations(),
      ]);
      screen = (
        <DepartmentMasterScreen rows={departments} locations={departmentLocations} perms={perms} />
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
    } else if (child.custom === "account_group") {
      const [groups, all] = await Promise.all([listAccountGroups(), listConfigLookups()]);
      screen = (
        <AccountGroupMasterScreen
          rows={groups}
          schedules={all.filter((l) => l.kind === "account_schedule")}
          perms={perms}
        />
      );
    } else if (child.custom === "account_head") {
      const [heads, accountGroups, costHeads] = await Promise.all([
        listAccountHeads(),
        listAccountGroups(),
        getCostHeads(),
      ]);
      screen = (
        <AccountHeadMasterScreen
          rows={heads}
          accountGroups={accountGroups}
          costHeads={costHeads}
          perms={perms}
        />
      );
    } else if (child.custom === "courier_delivery_address") {
      const [couriers, countries, all] = await Promise.all([
        listCourierDeliveryAddresses(),
        listCountries(),
        listConfigLookups(),
      ]);
      screen = (
        <CourierDeliveryAddressMasterScreen
          rows={couriers}
          countries={countries}
          cities={all.filter((l) => l.kind === "city")}
          states={all.filter((l) => l.kind === "state")}
          departments={all.filter((l) => l.kind === "department")}
          designations={all.filter((l) => l.kind === "designation")}
          internalDepartments={all.filter((l) => l.kind === "internal_department")}
          perms={perms}
        />
      );
    } else if (child.custom === "applicant") {
      const [applicants, countries, all, currencies, banks] = await Promise.all([
        listApplicants(),
        listCountries(),
        listConfigLookups(),
        listCurrencies(),
        listBanks(),
      ]);
      screen = (
        <ApplicantMasterScreen
          rows={applicants}
          countries={countries}
          cities={all.filter((l) => l.kind === "city")}
          states={all.filter((l) => l.kind === "state")}
          departments={all.filter((l) => l.kind === "department")}
          designations={all.filter((l) => l.kind === "designation")}
          internalDepartments={all.filter((l) => l.kind === "internal_department")}
          currencies={currencies}
          banks={banks}
          shipTypes={all.filter((l) => l.kind === "ship_type")}
          paymentTerms={all.filter((l) => l.kind === "payment_term")}
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
      ] = await Promise.all([
        listCustomers(),
        listApplicants(),
        listCountries(),
        listConfigLookups(),
        listCurrencies(),
        getVendorsForPicker(),
        getCourierOptions(),
        listReceivableTerms(),
        listPorts(),
        listDestinations(),
      ]);
      screen = (
        <CustomerMasterScreen
          rows={customers}
          applicants={applicants}
          countries={countries}
          cities={all.filter((l) => l.kind === "city")}
          states={all.filter((l) => l.kind === "state")}
          departments={all.filter((l) => l.kind === "department")}
          designations={all.filter((l) => l.kind === "designation")}
          internalDepartments={all.filter((l) => l.kind === "internal_department")}
          currencies={currencies}
          shipTypes={all.filter((l) => l.kind === "ship_type")}
          categories={all.filter((l) => l.kind === "material_category")}
          agentTypes={all.filter((l) => l.kind === "agent_type")}
          agentOptions={all.filter((l) => l.kind === "agent")}
          packingFormats={all.filter((l) => l.kind === "packing_list_format")}
          commercialFormats={all.filter((l) => l.kind === "commercial_invoice_format")}
          vendors={vendors.map((v) => ({ id: v.id, code: v.code, name: v.name }))}
          receivableTerms={terms.map((t) => ({
            id: t.id,
            code: String(t.entry_no),
            name: t.description ?? `Term #${t.entry_no}`,
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
          }))}
          couriers={couriers.map((c) => ({ id: c.id, code: c.code, name: c.name }))}
          perms={perms}
        />
      );
    } else if (child.custom === "employee") {
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
    } else if (child.custom === "merchandising_team") {
      const [teams, locations] = await Promise.all([
        listMerchandisingTeams(),
        listEmployeeLocations(),
      ]);
      screen = <MerchandisingTeamMasterScreen rows={teams} locations={locations} perms={perms} />;
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
    } else if (child.custom === "employee_category") {
      const employeeCategories = await listEmployeeCategories();
      screen = <EmployeeCategoryMasterScreen rows={employeeCategories} perms={perms} />;
    } else if (child.custom === "notify") {
      const [notifies, countries, all] = await Promise.all([
        listNotifies(),
        listCountries(),
        listConfigLookups(),
      ]);
      screen = (
        <NotifyMasterScreen
          rows={notifies}
          countries={countries}
          cities={all.filter((l) => l.kind === "city")}
          states={all.filter((l) => l.kind === "state")}
          departments={all.filter((l) => l.kind === "department")}
          designations={all.filter((l) => l.kind === "designation")}
          internalDepartments={all.filter((l) => l.kind === "internal_department")}
          perms={perms}
        />
      );
    } else if (child.custom === "consignee") {
      const [consignees, countries, all, customers, currencies, banks, notifies] = await Promise.all([
        listConsignees(),
        listCountries(),
        listConfigLookups(),
        listCustomers(),
        listCurrencies(),
        listBanks(),
        listNotifies(),
      ]);
      screen = (
        <ConsigneeMasterScreen
          rows={consignees}
          countries={countries}
          cities={all.filter((l) => l.kind === "city")}
          states={all.filter((l) => l.kind === "state")}
          departments={all.filter((l) => l.kind === "department")}
          designations={all.filter((l) => l.kind === "designation")}
          internalDepartments={all.filter((l) => l.kind === "internal_department")}
          customers={customers}
          currencies={currencies}
          banks={banks}
          shipTypes={all.filter((l) => l.kind === "ship_type")}
          paymentTerms={all.filter((l) => l.kind === "payment_term")}
          notifies={notifies}
          perms={perms}
        />
      );
    } else if (child.custom === "vendor") {
      const [vendors, countries, all, accountGroups] = await Promise.all([
        listVendors(),
        listCountries(),
        listConfigLookups(),
        listAccountGroups(),
      ]);
      screen = (
        <VendorMasterScreen
          rows={vendors}
          countries={countries}
          cities={all.filter((l) => l.kind === "city")}
          states={all.filter((l) => l.kind === "state")}
          groups={all.filter((l) => l.kind === "vendor_group")}
          accountGroups={accountGroups}
          perms={perms}
        />
      );
    } else if (child.custom === "tcs_assign") {
      const [tcsRows, countries] = await Promise.all([listCustomerTcs(), listCountries()]);
      screen = <TcsAssignScreen rows={tcsRows} countries={countries} perms={perms} />;
    } else if (child.custom === "gst_assign") {
      const rows = await listVendorGst();
      screen = <GstAssignScreen rows={rows} perms={perms} />;
    } else if (child.custom === "customer_gst_assign") {
      const [rows, all] = await Promise.all([listCustomerGst(), listConfigLookups()]);
      screen = (
        <CustomerGstAssignScreen
          rows={rows}
          cities={all.filter((l) => l.kind === "city")}
          perms={perms}
        />
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
    } else if (child.custom === "garment_rejection_rule") {
      const grrRules = await listGarmentRejectionRules();
      screen = <GarmentRejectionRuleMasterScreen rows={grrRules} perms={perms} />;
    } else if (child.custom === "hostel_category") {
      const rows = await listHostelCategories();
      screen = <HostelCategoryMasterScreen rows={rows} perms={perms} />;
    } else if (child.custom === "advance_loan_type") {
      const rows = await listAdvanceLoanTypes();
      screen = <AdvanceLoanTypeMasterScreen rows={rows} perms={perms} />;
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
