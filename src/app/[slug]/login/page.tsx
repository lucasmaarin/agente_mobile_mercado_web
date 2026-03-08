"use client";

import { useParams } from "next/navigation";
import Login from "@/components/Login/Login";

export default function SlugLoginPage() {
  const params = useParams();
  const slug = params.slug as string;

  return <Login redirectTo={`/${slug}`} />;
}
