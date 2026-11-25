import { notFound } from "next/navigation";

/** An unknown section, answered inside the product rather than by the framework. */
export default function UnknownSection() {
  notFound();
}
