import { redirect } from "next/navigation";

// Creating a new organisation is closed: access is by invitation only.
export default function OnboardingPage(){redirect("/app/planning")}
