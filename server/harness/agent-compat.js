'use strict';
const STATUS={awaiting_approval:'review',completed:'complete',failed:'error',interrupted:'interrupted'};
function toAgentProjection(run){
  const projected=new Map((run.tasks||[]).map(task=>[String(task.id),task]));
  const planned=run.plan?.tasks||[]; const seen=new Set(); const merged=[];
  for(const item of planned){const id=String(item.id??item.taskId??item.name);const event=projected.get(id)||{};seen.add(id);merged.push({...item,...event,id:event.id??item.id??item.taskId??item.name});}
  for(const task of projected.values())if(!seen.has(String(task.id)))merged.push({...task});
  const tasks=merged.map(task=>({id:task.id,name:task.title||task.name,title:task.title||task.name,description:task.description,status:task.status==='completed'?'complete':task.status==='running'?'in-progress':task.status}));
  const completedTasks=tasks.filter(task=>task.status==='complete').length; const totalTasks=tasks.length;
  return {id:run.id,mission:run.mission,cwd:run.cwd,status:STATUS[run.status]||run.status,progress:totalTasks?Math.round(completedTasks/totalTasks*100):0,totalTasks,completedTasks,tasks,logs:(run.logs||[]).slice(-200).map(log=>({time:log.timestamp||log.time,message:log.message})),createdAt:run.createdAt,useVibes:run.useVibes,attempt:run.attempt||1,error:run.failure?.reason||run.error};
}
function parseTaskStatus(line){if(typeof line!=='string'||!line.startsWith('[TASK_STATUS] '))return null;try{const value=JSON.parse(line.slice(14));if(!value||typeof value.name!=='string'||typeof value.status!=='string')return null;const upstream=value.id??value.taskId??value.name;return {id:String(upstream),taskId:String(upstream),name:value.name,status:value.status};}catch{return null;}}
module.exports={toAgentProjection,parseTaskStatus};
