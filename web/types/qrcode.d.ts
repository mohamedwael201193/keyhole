declare module "qrcode" {
  const QRCode: { toString(text: string, opts?: Record<string, unknown>): Promise<string> };
  export default QRCode;
}
