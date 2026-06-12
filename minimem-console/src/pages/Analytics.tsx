/**
 * 数据分析页面 — 全部基于真实数据
 * - 每日运行趋势（pipeline_runs 按天聚合）
 * - 层级分布饼图
 * - Pipeline 活跃度排行
 * - 温度分布条形图
 * - Pipeline 运行状态饼图
 * - 运行耗时分布
 */

import { useMemo } from 'react';
import {
  BarChart3, TrendingUp, Layers, Activity,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import { useAdminStats, useTemperature } from '@/api/minimem';
import { useRecentRuns, useDailyRunStats } from '@/api/pipeline';

// 主题感知颜色
const TEMP_COLORS: Record<string, string> = {
  hot: '#EF4444',
  warm: '#F59E0B',
  cool: '#3B82F6',
  cold: '#6366F1',
  frozen: '#94A3B8',
};

export default function Analytics() {
  const { data: stats } = useAdminStats();
  const { data: temperature } = useTemperature();
  const { data: recentRunsData } = useRecentRuns(50);
  const { data: dailyStats } = useDailyRunStats(30);

  const recentRuns = recentRunsData?.runs || [];

  // 层级分布数据（真实 API）
  const layerData = useMemo(() => {
    if (!stats?.by_layer) return [];
    const layers = [
      { name: 'L1 经历', value: stats.by_layer['L1'] || 0, color: '#3B82F6' },
      { name: 'L2 事实', value: stats.by_layer['L2'] || 0, color: '#8B5CF6' },
      { name: 'L3 观察', value: stats.by_layer['L3'] || 0, color: '#F59E0B' },
      { name: 'L4 心智', value: stats.by_layer['L4'] || 0, color: '#EF4444' },
    ];
    return layers.filter((l) => l.value > 0);
  }, [stats]);

  // 温度分布条形数据（真实 API）
  const tempBarData = useMemo(() => {
    if (!temperature) return [];
    return Object.entries(temperature).map(([key, value]) => ({
      name: key === 'hot' ? '热' : key === 'warm' ? '温' : key === 'cool' ? '凉' : key === 'cold' ? '冷' : '冻',
      count: value as number,
      fill: TEMP_COLORS[key] || '#94A3B8',
    }));
  }, [temperature]);

  // 每日运行趋势（真实数据 — 来自 pipeline_runs 按天聚合）
  const dailyTrend = useMemo(() => {
    if (!dailyStats?.daily?.length) return [];
    return dailyStats.daily.map((d) => ({
      day: d.day.slice(5), // "2025-04-25" → "04-25"
      成功: d.success,
      失败: d.failed,
      部分: d.partial,
      total: d.total,
      avgDuration: d.avg_duration_ms ? Math.round(d.avg_duration_ms / 1000) : 0,
    }));
  }, [dailyStats]);

  // Pipeline 活跃度排行（真实数据 — 来自 pipeline_runs 按 pipeline 聚合）
  const pipelineActivity = useMemo(() => {
    if (!dailyStats?.byPipeline?.length) return [];
    return dailyStats.byPipeline.map((p) => ({
      name: (p.pipeline_name || '未命名').length > 10
        ? (p.pipeline_name || '未命名').slice(0, 10) + '…'
        : (p.pipeline_name || '未命名'),
      运行次数: p.run_count,
      成功次数: p.success_count,
      successRate: p.run_count > 0 ? Math.round((p.success_count / p.run_count) * 100) : 0,
    }));
  }, [dailyStats]);

  // Pipeline 运行状态统计（真实数据 — 来自 recentRuns）
  const runStats = useMemo(() => {
    const statusCounts = { success: 0, failed: 0, partial: 0 };
    recentRuns.forEach((r) => {
      if (r.status in statusCounts) {
        (statusCounts as any)[r.status]++;
      }
    });
    return [
      { name: '成功', value: statusCounts.success, color: '#10B981' },
      { name: '失败', value: statusCounts.failed, color: '#EF4444' },
      { name: '部分', value: statusCounts.partial, color: '#F59E0B' },
    ].filter((s) => s.value > 0);
  }, [recentRuns]);

  // 运行耗时分布（真实数据 — 来自 recentRuns）
  const durationData = useMemo(() => {
    return recentRuns
      .filter((r) => r.duration_ms != null)
      .slice(0, 20)
      .reverse()
      .map((r, i) => ({
        index: i + 1,
        duration: ((r.duration_ms || 0) / 1000).toFixed(1),
        status: r.status,
      }));
  }, [recentRuns]);

  // 共用 Tooltip 样式
  const tooltipStyle = {
    background: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '8px',
    fontSize: '11px',
  };

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div>
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" strokeWidth={1.8} />
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            数据分析
          </h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          记忆统计、运行趋势、Pipeline 活跃度分析
        </p>
      </div>

      {/* 第一行：每日运行趋势 + 层级分布 */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* 每日运行趋势（真实数据） */}
        <div className="col-span-2 rounded-2xl bg-card p-5 shadow-apple">
          <div className="mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              每日运行趋势（近 30 天）
            </h3>
          </div>
          {dailyTrend.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={dailyTrend}>
                <defs>
                  <linearGradient id="gradSuccess" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradFailed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#EF4444" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#EF4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: '10px' }} />
                <Area type="monotone" dataKey="成功" stroke="#10B981" fill="url(#gradSuccess)" strokeWidth={2} />
                <Area type="monotone" dataKey="失败" stroke="#EF4444" fill="url(#gradFailed)" strokeWidth={2} />
                <Area type="monotone" dataKey="部分" stroke="#F59E0B" fill="transparent" strokeWidth={1.5} strokeDasharray="4 4" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
              暂无运行记录
            </div>
          )}
        </div>

        {/* 层级分布饼图（真实数据） */}
        <div className="rounded-2xl bg-card p-5 shadow-apple">
          <div className="mb-4 flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              层级分布
            </h3>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={layerData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={4}
                dataKey="value"
              >
                {layerData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: '10px' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 第二行：Pipeline 活跃度 + 温度分布 */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Pipeline 活跃度排行（真实数据） */}
        <div className="rounded-2xl bg-card p-5 shadow-apple">
          <div className="mb-4 flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Pipeline 活跃度（近 30 天）
            </h3>
          </div>
          {pipelineActivity.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={pipelineActivity} barSize={20} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
                <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={80} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: number, name: string, props: any) => {
                    if (name === '运行次数') {
                      return [`${value} 次 (成功率 ${props.payload.successRate}%)`, name];
                    }
                    return [value, name];
                  }}
                />
                <Bar dataKey="运行次数" fill="#3B82F6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
              暂无运行记录
            </div>
          )}
        </div>

        {/* 温度分布条形图（真实数据） */}
        <div className="rounded-2xl bg-card p-5 shadow-apple">
          <div className="mb-4 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              当前温度分布
            </h3>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={tempBarData} barSize={32}>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" name="记忆数" radius={[6, 6, 0, 0]}>
                {tempBarData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 第三行：Pipeline 运行统计 + 运行耗时 */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Pipeline 运行状态饼图（真实数据） */}
        <div className="rounded-2xl bg-card p-5 shadow-apple">
          <div className="mb-4 flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Pipeline 运行状态
            </h3>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex-1">
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={runStats}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={65}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {runStats.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2">
              {runStats.map((s) => (
                <div key={s.name} className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="text-xs text-foreground">{s.name}</span>
                  <span className="text-xs font-semibold text-foreground">{s.value}</span>
                </div>
              ))}
              <div className="border-t border-border/40 pt-1">
                <span className="text-[10px] text-muted-foreground">
                  共 {recentRuns.length} 次运行
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 运行耗时（真实数据） */}
        <div className="rounded-2xl bg-card p-5 shadow-apple">
          <div className="mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              最近运行耗时 (秒)
            </h3>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={durationData} barSize={12}>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
              <XAxis dataKey="index" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="duration" name="耗时(s)" fill="#3B82F6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
