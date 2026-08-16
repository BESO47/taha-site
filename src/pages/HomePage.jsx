import Hero from '../components/Hero.jsx'
import YearsSection from '../components/YearsSection.jsx'
import WhyUsSection from '../components/WhyUsSection.jsx'

export default function HomePage() {
  return (
    <div className="w-full">
      <Hero />
      <YearsSection />
      <WhyUsSection />
    </div>
  )
}
