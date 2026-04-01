import { DashboardLayout } from '../components/DashboardLayout';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';

const mockSchedule = [
  { id: 1, date: '2026-03-26', project: 'Pebble Beach', grass: 'Bermuda 419', qty: 8500, farm: 'North Farm', type: 'harvest' },
  { id: 2, date: '2026-03-27', project: 'Augusta National', grass: 'Tifway 419', qty: 12000, farm: 'South Farm', type: 'delivery' },
  { id: 3, date: '2026-03-28', project: 'Pinehurst No. 2', grass: 'SeaDwarf', qty: 9200, farm: 'East Farm', type: 'harvest' },
  { id: 4, date: '2026-03-29', project: 'St. Andrews', grass: 'Zeon Zoysia', qty: 7800, farm: 'West Farm', type: 'delivery' },
  { id: 5, date: '2026-03-30', project: 'Oakmont CC', grass: 'Bermuda 419', qty: 11500, farm: 'North Farm', type: 'harvest' },
  { id: 6, date: '2026-03-31', project: 'Shinnecock Hills', grass: 'Tifway 419', qty: 10200, farm: 'South Farm', type: 'delivery' },
  { id: 7, date: '2026-04-01', project: 'Merion Golf Club', grass: 'Meyer Zoysia', qty: 6500, farm: 'East Farm', type: 'harvest' },
  { id: 8, date: '2026-04-02', project: 'Cypress Point', grass: 'SeaDwarf', qty: 8900, farm: 'West Farm', type: 'delivery' },
];

export function Planning() {
  const [currentDate, setCurrentDate] = useState(new Date('2026-03-25'));

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    return { daysInMonth, startingDayOfWeek };
  };

  const getEventsForDate = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0];
    return mockSchedule.filter(event => event.date === dateStr);
  };

  const { daysInMonth, startingDayOfWeek } = getDaysInMonth(currentDate);
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const previousMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  return (
    <DashboardLayout>
      <div className="p-4 lg:p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl lg:text-3xl font-semibold text-gray-900">Planning & Schedule</h1>
        </div>

        {/* Calendar */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </h2>
            <div className="flex gap-2">
              <button
                onClick={previousMonth}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={nextMonth}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="p-4">
            {/* Calendar Grid - Desktop */}
            <div className="hidden md:block">
              <div className="grid grid-cols-7 gap-2 mb-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <div key={day} className="text-center text-sm font-medium text-gray-600 py-2">
                    {day}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-2">
                {Array.from({ length: startingDayOfWeek }).map((_, i) => (
                  <div key={`empty-${i}`} className="aspect-square" />
                ))}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1;
                  const date = new Date(year, month, day);
                  const events = getEventsForDate(date);
                  const isToday = date.toDateString() === new Date('2026-03-25').toDateString();

                  return (
                    <div
                      key={day}
                      className={`aspect-square border rounded-lg p-2 ${
                        isToday ? 'border-[#1F7A4C] bg-green-50' : 'border-gray-200'
                      } hover:border-[#1F7A4C] transition-colors cursor-pointer`}
                    >
                      <div className={`text-sm font-medium mb-1 ${isToday ? 'text-[#1F7A4C]' : 'text-gray-900'}`}>
                        {day}
                      </div>
                      <div className="space-y-1">
                        {events.slice(0, 2).map(event => (
                          <div
                            key={event.id}
                            className={`text-xs px-1 py-0.5 rounded truncate ${
                              event.type === 'harvest'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-green-100 text-green-800'
                            }`}
                          >
                            {event.project}
                          </div>
                        ))}
                        {events.length > 2 && (
                          <div className="text-xs text-gray-500">+{events.length - 2} more</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Calendar List - Mobile */}
            <div className="md:hidden space-y-2">
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const date = new Date(year, month, day);
                const events = getEventsForDate(date);
                if (events.length === 0) return null;

                return (
                  <div key={day} className="border border-gray-200 rounded-lg p-3">
                    <div className="font-medium text-gray-900 mb-2">
                      {date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </div>
                    <div className="space-y-2">
                      {events.map(event => (
                        <div
                          key={event.id}
                          className={`p-2 rounded text-sm ${
                            event.type === 'harvest'
                              ? 'bg-blue-50 border border-blue-200'
                              : 'bg-green-50 border border-green-200'
                          }`}
                        >
                          <div className="font-medium">{event.project}</div>
                          <div className="text-xs text-gray-600 mt-1">
                            {event.grass} • {event.qty.toLocaleString()} sq. ft.
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Upcoming Schedule */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Upcoming Schedule</h2>
          </div>
          <div className="divide-y divide-gray-200">
            {mockSchedule.slice(0, 5).map((event) => (
              <div key={event.id} className="p-4 hover:bg-gray-50 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                          event.type === 'harvest'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-green-100 text-green-800'
                        }`}
                      >
                        {event.type === 'harvest' ? 'Harvest' : 'Delivery'}
                      </span>
                      <span className="font-medium text-gray-900">{event.project}</span>
                    </div>
                    <div className="text-sm text-gray-600">
                      {event.grass} • {event.qty.toLocaleString()} sq. ft. • {event.farm}
                    </div>
                  </div>
                  <div className="text-sm text-gray-600">
                    {new Date(event.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
