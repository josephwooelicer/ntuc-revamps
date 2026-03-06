export const metadata = {
  title: "NTUC EWS",
  description: "NTUC Retrenchment Early Warning System"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
