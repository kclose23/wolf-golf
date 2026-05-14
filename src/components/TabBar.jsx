export default function TabBar({ tabs, active, onChange }) {
  return (
    <div className="flex overflow-x-auto border-b border-gray-200 bg-white sticky top-[53px] z-30 no-scrollbar">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex-shrink-0 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
            ${active === tab.id
              ? 'border-green-600 text-green-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
