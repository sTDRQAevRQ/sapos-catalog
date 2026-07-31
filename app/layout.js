import "./globals.css";

export const metadata = {
  title: "Sapos Parfums Catalogue",
  description: "Catalogue dynamique Sapos Parfums, filtrable et mobile-first."
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
