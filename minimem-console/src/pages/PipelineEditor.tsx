import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import { toast } from 'sonner';
import {
  usePipeline,
  useNodeTypes,
  useUpdatePipeline,
  useRunPipeline,
  useTogglePipeline,
  useCreatePipeline,
  type PipelineNode,
  type PipelineEdge,
  type NodeType,
} from '@/api/pipeline';
import { Canvas } from '@/components/pipeline/Canvas';
import { NodePalette } from '@/components/pipeline/NodePalette';
import { ConfigPanel } from '@/components/pipeline/ConfigPanel';
import { PipelineToolbar } from '@/components/pipeline/PipelineToolbar';

export default function PipelineEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const { data: pipeline, isLoading: pipelineLoading } = usePipeline(isNew ? '' : id!);
  const { data: nodeTypesData } = useNodeTypes();
  const updateMutation = useUpdatePipeline();
  const createMutation = useCreatePipeline();
  const runMutation = useRunPipeline();
  const toggleMutation = useTogglePipeline();

  const nodeTypes: NodeType[] = nodeTypesData?.nodeTypes || [];

  // 本地编辑状态
  const [name, setName] = useState('新建 Pipeline');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [nodes, setNodes] = useState<PipelineNode[]>([]);
  const [edges, setEdges] = useState<PipelineEdge[]>([]);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [scheduleType, setScheduleType] = useState('manual');
  const [scheduleCron, setScheduleCron] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // 从服务端加载数据
  useEffect(() => {
    if (pipeline && !initialized && nodeTypes.length > 0) {
      setName(pipeline.name);
      setDescription(pipeline.description);
      setEnabled(pipeline.enabled);
      // 补全节点的 inputs/outputs（数据库可能没存储端口定义）
      const enrichedNodes = (pipeline.nodes || []).map((n) => {
        if ((!n.inputs || n.inputs.length === 0) || (!n.outputs || n.outputs.length === 0)) {
          const nt = nodeTypes.find((t) => t.type === n.type);
          if (nt) {
            return {
              ...n,
              inputs: n.inputs?.length ? n.inputs : nt.inputs,
              outputs: n.outputs?.length ? n.outputs : nt.outputs,
            };
          }
        }
        return n;
      });
      setNodes(enrichedNodes);
      setEdges(pipeline.edges || []);
      setVariables(pipeline.variables || {});
      setScheduleType(pipeline.schedule_type || 'manual');
      setScheduleCron(pipeline.schedule_cron || '');
      setInitialized(true);
      setHasChanges(false);
    }
  }, [pipeline, initialized, nodeTypes]);

  // 新建时直接初始化
  useEffect(() => {
    if (isNew && !initialized) {
      setInitialized(true);
    }
  }, [isNew, initialized]);

  const markChanged = useCallback(() => setHasChanges(true), []);

  const handleNodesChange = useCallback(
    (newNodes: PipelineNode[]) => {
      setNodes(newNodes);
      markChanged();
    },
    [markChanged],
  );

  const handleEdgesChange = useCallback(
    (newEdges: PipelineEdge[]) => {
      setEdges(newEdges);
      markChanged();
    },
    [markChanged],
  );

  // 拖放创建新节点
  const handleDropNode = useCallback(
    (type: string, position: { x: number; y: number }) => {
      const nt = nodeTypes.find((t) => t.type === type);
      if (!nt) return;

      const newNode: PipelineNode = {
        id: `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        type,
        label: nt.label,
        position,
        config: buildDefaultConfig(nt),
        inputs: nt.inputs,
        outputs: nt.outputs,
      };
      setNodes((prev) => [...prev, newNode]);
      setSelectedNodeId(newNode.id);
      markChanged();
    },
    [nodeTypes, markChanged],
  );

  // 更新单个节点
  const handleUpdateNode = useCallback(
    (nodeId: string, updates: Partial<PipelineNode>) => {
      setNodes((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, ...updates } : n)),
      );
      markChanged();
    },
    [markChanged],
  );

  // 删除节点
  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((prev) => prev.filter((n) => n.id !== nodeId));
      setEdges((prev) =>
        prev.filter((e) => e.source_node !== nodeId && e.target_node !== nodeId),
      );
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      markChanged();
    },
    [selectedNodeId, markChanged],
  );

  // 保存
  const handleSave = useCallback(async () => {
    const data = {
      name,
      description,
      nodes,
      edges,
      variables,
      schedule_type: scheduleType,
      schedule_cron: scheduleType === 'cron' ? scheduleCron : undefined,
    };

    try {
      if (isNew) {
        const created = await createMutation.mutateAsync(data as any);
        setHasChanges(false);
        toast.success('Pipeline 创建成功');
        navigate(`/pipelines/${created.id}/edit`, { replace: true });
      } else {
        await updateMutation.mutateAsync({ id: id!, ...data } as any);
        setHasChanges(false);
        toast.success('已保存');
      }
    } catch (err: any) {
      toast.error('保存失败', {
        description: err?.message || '未知错误',
      });
    }
  }, [name, description, nodes, edges, variables, scheduleType, scheduleCron, isNew, id, createMutation, updateMutation, navigate]);

  // 运行
  const handleRun = useCallback(() => {
    if (!isNew && id) {
      runMutation.mutate(id, {
        onSuccess: () => {
          toast.success(`「${name}」已开始运行`, {
            description: '完成后可在运行历史中查看结果',
          });
        },
        onError: (err: any) => {
          toast.error('运行失败', { description: err?.message || '未知错误' });
        },
      });
    }
  }, [isNew, id, name, runMutation]);

  // 切换启停
  const handleToggle = useCallback(() => {
    if (!isNew && id) {
      const newEnabled = !enabled;
      toggleMutation.mutate(id, {
        onSuccess: () => {
          setEnabled(newEnabled);
          toast.success(newEnabled ? '已启用 Pipeline' : '已禁用 Pipeline');
        },
        onError: (err) => {
          toast.error('切换失败', { description: err?.message || '未知错误' });
        },
      });
    }
  }, [isNew, id, enabled, toggleMutation]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const selectedNodeType = selectedNode
    ? nodeTypes.find((nt) => nt.type === selectedNode.type)
    : undefined;

  if (!isNew && pipelineLoading) {
    return (
      <div className="flex h-[calc(100vh-48px)] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="-mx-6 -my-6 flex h-[calc(100vh-0px)] flex-col">
      {/* 工具栏 */}
      <PipelineToolbar
        name={name}
        enabled={enabled}
        scheduleType={scheduleType}
        scheduleCron={scheduleCron}
        variables={variables}
        isSaving={updateMutation.isPending || createMutation.isPending}
        isRunning={runMutation.isPending}
        hasChanges={hasChanges}
        onNameChange={(n) => { setName(n); markChanged(); }}
        onSave={handleSave}
        onRun={handleRun}
        onToggle={handleToggle}
        onBack={() => navigate('/pipelines')}
        onScheduleChange={(type, cron) => {
          setScheduleType(type);
          setScheduleCron(cron);
          markChanged();
        }}
        onVariablesChange={(vars) => {
          setVariables(vars);
          markChanged();
        }}
      />

      {/* 主区域 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧节点面板 */}
        <NodePalette nodeTypes={nodeTypes} />

        {/* 中间画布 */}
        <div className="flex-1">
          <ReactFlowProvider>
            <Canvas
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              selectedNodeId={selectedNodeId}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onSelectNode={setSelectedNodeId}
              onDropNode={handleDropNode}
            />
          </ReactFlowProvider>
        </div>

        {/* 右侧属性面板 */}
        {selectedNode && (
          <ConfigPanel
            node={selectedNode}
            nodeType={selectedNodeType}
            onUpdate={handleUpdateNode}
            onDelete={handleDeleteNode}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>
    </div>
  );
}

// ── 根据 Schema 生成默认配置 ──

function buildDefaultConfig(nt: NodeType): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(nt.configSchema || {})) {
    if ((field as any).default !== undefined) {
      config[key] = (field as any).default;
    }
  }
  return config;
}
