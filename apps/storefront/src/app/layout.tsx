import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import TabBar from "@/components/TabBar";
import ScrollProgress from "@/components/motion/ScrollProgress";
import { STORE_NAME } from "@/lib/supabase";
import { fetchCategories, safe } from "@/lib/catalog";

const arabic = IBM_Plex_Sans_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: `${STORE_NAME} — موبايلات ولابتوبات وإكسسوارات`, template: `%s | ${STORE_NAME}` },
  description: "موبايلات ولابتوبات وإكسسوارات وشواحن بأسعار واضحة. احجز طلبك أونلاين واستلمه من المحل أو بالتوصيل.",
};

const WHATSAPP = (process.env.NEXT_PUBLIC_WHATSAPP || "").replace(/\D/g, "");

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { data: categories } = await safe(fetchCategories(), []);

  return (
    <html lang="ar" dir="rtl" className={`${arabic.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col pb-20 md:pb-0">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-accent focus:p-3 focus:text-white">
          تخطي إلى المحتوى
        </a>
        <ScrollProgress />
        <div className="bg-(image:--brand-gradient) px-4 py-2 text-center text-xs font-medium text-white sm:text-sm">
          احجز مجانًا لمدة 24 ساعة · استلام من المحل أو توصيل · الدفع عند التأكيد
        </div>
        <Header categories={categories} />
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
          {children}
        </main>
        <footer className="border-t border-line bg-surface">
          <div className="mx-auto max-w-7xl space-y-1 px-4 py-8 text-sm text-muted">
            <p className="text-base font-bold text-fg">{STORE_NAME}</p>
            <p>الأسعار والتوافر المعروضان يُعاد التحقق منهما عند تأكيد الطلب.</p>
            <p>الحجز مؤقت لمدة 24 ساعة حتى يتم تأكيد الطلب من المحل.</p>
          </div>
        </footer>
        {WHATSAPP && (
          <a
            href={`https://wa.me/${WHATSAPP}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="تواصل معنا على واتساب"
            className="fixed bottom-24 start-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-[#25d366] text-2xl text-white shadow-lg md:bottom-6"
          >
            💬
          </a>
        )}
        <TabBar />
      </body>
    </html>
  );
}
