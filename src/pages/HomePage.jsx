import Hero from '../components/Hero.jsx'
import YearsSection from '../components/YearsSection.jsx'
import HowItWorksSection from '../components/HowItWorksSection.jsx'
import TeacherSection from '../components/TeacherSection.jsx'
import FeaturesSection from '../components/FeaturesSection.jsx'
import FAQSection from '../components/FAQSection.jsx'
import CTASection from '../components/CTASection.jsx'

export default function HomePage() {
  return (
    <div className="w-full">
      <Hero />
      <YearsSection />
      <HowItWorksSection />
      <TeacherSection />
      <FeaturesSection />
      <FAQSection />
      <CTASection />
    </div>
  )
}
