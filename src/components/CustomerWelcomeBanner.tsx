import './CustomerWelcomeBanner.css';

const CustomerWelcomeBanner = ({ customerName }: { customerName?: string }) => (
  <section className="customer-welcome-banner" aria-label="Welcome">
    <div className="customer-welcome-banner__greeting">NAMASTE</div>
    <h1 className="customer-welcome-banner__heading" aria-label="Welcome back">
      <span>WELCOME</span>
      <img
        className="customer-welcome-banner__image"
        src="/images/dashboard-namaste-v2.png"
        alt="Folded hands in a Namaste greeting"
        width={120}
        height={120}
      />
      <span>BACK</span>
    </h1>
    <div className="customer-welcome-banner__name">{(customerName?.trim() || 'Valued partner').toUpperCase()}</div>
  </section>
);

export default CustomerWelcomeBanner;
