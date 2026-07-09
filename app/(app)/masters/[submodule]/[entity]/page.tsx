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
import { listApplicants } from "@/lib/masters/applicant-service";
import { listConfigLookups } from "@/lib/masters/extras-service";
import { listCurrencies } from "@/lib/masters/service";
import { ApplicantMasterScreen } from "@/components/masters/applicant-master-screen";
import { listCustomers } from "@/lib/masters/customer-service";
import { CustomerMasterScreen } from "@/components/masters/customer-master-screen";
import { listNotifies } from "@/lib/masters/notify-service";
import { NotifyMasterScreen } from "@/components/masters/notify-master-screen";

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
      const [customers, applicants, countries, all] = await Promise.all([
        listCustomers(),
        listApplicants(),
        listCountries(),
        listConfigLookups(),
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
          perms={perms}
        />
      );
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
