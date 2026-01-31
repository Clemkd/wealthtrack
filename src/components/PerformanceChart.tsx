import { Transaction } from '../types/database';
import { useMemo } from 'react';

interface PerformanceChartProps {
  transactions: Transaction[];
}

interface DataPoint {
  date: Date;
  value: number;
  cumulativeValue: number;
}

export default function PerformanceChart({ transactions }: PerformanceChartProps) {
  const chartData = useMemo(() => {
    if (transactions.length === 0) return [];

    const sortedTx = [...transactions].sort(
      (a, b) => new Date(a.transaction_date).getTime() - new Date(b.transaction_date).getTime()
    );

    let cumulative = 0;
    const points: DataPoint[] = sortedTx.map((tx) => {
      if (tx.transaction_type === 'buy') {
        cumulative += tx.total_value;
      } else if (tx.transaction_type === 'sell') {
        cumulative -= tx.total_value;
      }

      return {
        date: new Date(tx.transaction_date),
        value: tx.total_value,
        cumulativeValue: cumulative,
      };
    });

    return points;
  }, [transactions]);

  if (chartData.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
        <p className="text-gray-500">Aucune donnée à afficher</p>
      </div>
    );
  }

  const width = 800;
  const height = 400;
  const padding = 60;

  const maxValue = Math.max(...chartData.map((d) => d.cumulativeValue));
  const minValue = Math.min(...chartData.map((d) => d.cumulativeValue), 0);
  const valueRange = maxValue - minValue || 1;

  const xScale = (index: number) =>
    padding + (index / (chartData.length - 1 || 1)) * (width - 2 * padding);

  const yScale = (value: number) =>
    height - padding - ((value - minValue) / valueRange) * (height - 2 * padding);

  const pathData = chartData
    .map((point, index) => {
      const x = xScale(index);
      const y = yScale(point.cumulativeValue);
      return index === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
    })
    .join(' ');

  const areaPath =
    pathData +
    ` L ${xScale(chartData.length - 1)} ${height - padding}` +
    ` L ${xScale(0)} ${height - padding} Z`;

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
  };

  const formatValue = (value: number) => {
    return `${value.toLocaleString('fr-FR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })} €`;
  };

  const yTicks = 5;
  const yTickValues = Array.from({ length: yTicks }, (_, i) => {
    return minValue + (valueRange / (yTicks - 1)) * i;
  });

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="mb-6">
        <h3 className="text-lg font-bold text-gray-900 mb-2">Investissement cumulé</h3>
        <p className="text-sm text-gray-600">
          Évolution de votre investissement total au fil du temps
        </p>
      </div>

      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
          <defs>
            <linearGradient id="chartGradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.05" />
            </linearGradient>
          </defs>

          {yTickValues.map((value, i) => (
            <g key={i}>
              <line
                x1={padding}
                y1={yScale(value)}
                x2={width - padding}
                y2={yScale(value)}
                stroke="#e5e7eb"
                strokeWidth="1"
              />
              <text
                x={padding - 10}
                y={yScale(value)}
                textAnchor="end"
                alignmentBaseline="middle"
                fontSize="12"
                fill="#6b7280"
              >
                {formatValue(value)}
              </text>
            </g>
          ))}

          <path d={areaPath} fill="url(#chartGradient)" />

          <path d={pathData} fill="none" stroke="#3b82f6" strokeWidth="3" />

          {chartData.map((point, index) => (
            <g key={index}>
              <circle
                cx={xScale(index)}
                cy={yScale(point.cumulativeValue)}
                r="4"
                fill="#3b82f6"
                stroke="white"
                strokeWidth="2"
              >
                <title>
                  {formatDate(point.date)}: {formatValue(point.cumulativeValue)}
                </title>
              </circle>
            </g>
          ))}

          {chartData.length > 1 && (
            <>
              <text
                x={xScale(0)}
                y={height - padding + 25}
                textAnchor="middle"
                fontSize="12"
                fill="#6b7280"
              >
                {formatDate(chartData[0].date)}
              </text>
              <text
                x={xScale(chartData.length - 1)}
                y={height - padding + 25}
                textAnchor="middle"
                fontSize="12"
                fill="#6b7280"
              >
                {formatDate(chartData[chartData.length - 1].date)}
              </text>
            </>
          )}
        </svg>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-4">
        <div className="bg-blue-50 rounded-lg p-4">
          <p className="text-sm text-blue-600 font-medium mb-1">Investissement total</p>
          <p className="text-2xl font-bold text-blue-900">
            {formatValue(chartData[chartData.length - 1]?.cumulativeValue || 0)}
          </p>
        </div>
        <div className="bg-green-50 rounded-lg p-4">
          <p className="text-sm text-green-600 font-medium mb-1">Plus haut</p>
          <p className="text-2xl font-bold text-green-900">{formatValue(maxValue)}</p>
        </div>
        <div className="bg-orange-50 rounded-lg p-4">
          <p className="text-sm text-orange-600 font-medium mb-1">Transactions</p>
          <p className="text-2xl font-bold text-orange-900">{chartData.length}</p>
        </div>
      </div>
    </div>
  );
}
