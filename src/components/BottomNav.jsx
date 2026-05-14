export default function BottomNav({ screen, setScreen, isScorer }) {
  const tabs = [
    { id: 'score', label: 'Score', icon: '⛳' },
    { id: 'leaderboard', label: 'Leaderboard', icon: '🏆' },
    { id: 'settlement', label: 'Pay Up', icon: '💵' },
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex z-50 safe-bottom">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setScreen(tab.id)}
          className={`flex-1 flex flex-col items-center gap-0.5 py-3 text-xs font-medium transition-colors
            ${screen === tab.id ? 'text-green-600' : 'text-gray-400'}`}
        >
          <span className="text-xl leading-none">{tab.icon}</span>
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  )
}
