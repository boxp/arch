"""Live adapter safety gates with fake HTTP/SSH/GitOps, no external I/O."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

PATH=Path(__file__).resolve().parents[2]/'docker/codex-workspace/qwen-eval'
sys.path.insert(0,str(PATH))
import live

class LiveSafety(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.adapter=live.LiveAdapter(self.temp.name,self.temp.name,'BOXP-344-test')
        self.adapter.gpu_pids=lambda:{'123':'llama-server'}
        self.adapter.ssh=lambda *a,**k:'{}'
        self.adapter.phase=lambda phase:None
        self.adapter.acquire_lease=lambda:None
        self.adapter.require_gate=lambda mode:({'metadata':{'uid':'one'}},'http://fake')
        self.calls=[]
    def response(self,url,method='GET',data=None,timeout=10):
        self.calls.append(url)
        if ':8081/' in url: raise urllib.error.URLError('refused')
        if '/stats?' in url:
            return 200,json.dumps({'stats':[{'name':'cluster.llama_server.upstream_rq_active','value':0},
                                           {'name':'cluster.llama_server.upstream_rq_pending_active','value':0}]})
        if url.endswith('/models'):
            return 200,json.dumps({'data':[{'id':'gemma4-26b','status':{'value':'loaded'}}]})
        if '/slots?' in url: return 200,json.dumps([{'is_processing':False}])
        return 503,'fenced'
    def test_verified_drain_checks_all_ingress_and_slots(self):
        with patch.object(live,'http',side_effect=self.response), patch.object(live.time,'sleep'):
            self.adapter.fence_and_drain()
        self.assertEqual(self.adapter.pod_uid,'one')
        self.assertGreaterEqual(sum('/slots?' in x for x in self.calls),4)
        self.assertTrue(any('192.168.10.95:8080' in x for x in self.calls))
        self.assertTrue(any('svc.cluster.local' in x for x in self.calls))
    def test_unknown_gpu_owner_never_creates_switch_pr(self):
        self.adapter.gpu_pids=lambda:{'123':'other-gpu-test'}
        phases=[];self.adapter.phase=phases.append
        with self.assertRaises(RuntimeError): self.adapter.fence_and_drain()
        self.assertEqual(phases,[])
    def test_busy_slots_prevent_switch(self):
        def busy(url,*args,**kwargs):
            if '/slots?' in url: return 200,'[{"is_processing":true}]'
            return self.response(url,*args,**kwargs)
        with patch.object(live,'http',side_effect=busy), patch.object(live.time,'sleep'):
            with self.assertRaises(TimeoutError): self.adapter.fence_and_drain()
        self.assertIsNone(self.adapter.pod_uid)
    def test_raw_port_bypass_prevents_switch(self):
        def raw(url,*args,**kwargs):
            if ':8081/' in url:return 200,'reachable'
            return self.response(url,*args,**kwargs)
        with patch.object(live,'http',side_effect=raw), patch.object(live.time,'sleep'):
            with self.assertRaises(RuntimeError): self.adapter.fence_and_drain()
    def test_changed_pod_prevents_gemma_stop(self):
        self.adapter.pod_uid='old'
        phases=[];self.adapter.phase=phases.append
        with self.assertRaises(RuntimeError):self.adapter.stop_gemma_and_prove_gpu_free()
        self.assertEqual(phases,[])

class UncertainExecution(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.a=live.LiveAdapter(self.temp.name,self.temp.name,'BOXP-344-test')
        self.a.assert_lease=lambda:None
    def test_unsettled_pr_prevents_gemma_restore(self):
        self.a.pending_phase='start-qwen'
        with patch.object(live,'cluster',side_effect=AssertionError('must not infer desired state')):
            with self.assertRaises(RuntimeError):self.a.stop_qwen_and_prove_gpu_free()
    def test_uncertain_queue_stops_qwen_but_does_not_reopen(self):
        self.a.uncertain_job='unknown'
        phases=[];self.a.phase=phases.append;self.a.gpu_pids=lambda:{}
        with patch.object(live,'cluster',return_value={'spec':{'replicas':1}}):
            with self.assertRaises(RuntimeError):self.a.stop_qwen_and_prove_gpu_free()
        self.assertEqual(phases,['stop-qwen'])
        with self.assertRaises(RuntimeError):self.a.reopen()
    def test_lost_lease_prevents_any_switch(self):
        with self.assertRaises(RuntimeError):self.a.__class__.assert_lease(self.a)
    def test_lost_lease_cancels_own_open_control_pr(self):
        self.a.assert_lease=lambda:(_ for _ in ()).throw(RuntimeError('lost'))
        commands=[]
        def fake(args,**kwargs):
            commands.append(args)
            if args[1:3]==['pr','view']:
                return '{"state":"CLOSED"}' if any(x[1:3]==['pr','close'] for x in commands) else '{"state":"OPEN"}'
            return ''
        with patch.object(live,'command',side_effect=fake):
            with self.assertRaises(RuntimeError):self.a.guard_pending_pr('https://github.com/boxp/lolice/pull/1')
        self.assertTrue(any(x[1:3]==['pr','close'] for x in commands))
    def test_merged_but_unconverged_phase_remains_unsettled(self):
        self.a.token='BOXP-344-test'
        for file,count in ((live.GEMMA,0),(live.QWEN,0)):
            p=Path(self.temp.name)/file;p.parent.mkdir(parents=True,exist_ok=True)
            p.write_text('spec:\n  replicas: '+str(count)+'\n')
        p=Path(self.temp.name)/live.GATE;p.write_text('data:\n  state: closed:BOXP-344-test\n')
        def fake(args,**kwargs):
            if args[:3]==['gh','pr','create']:return 'https://github.com/boxp/lolice/pull/1'
            if args[:3]==['gh','pr','view']:return '{"state":"MERGED","mergeCommit":{"oid":"'+'a'*40+'"}}'
            return ''
        self.a.wait_deploy=lambda *args:(_ for _ in ()).throw(TimeoutError('Argo not converged'))
        with patch.object(live,'command',side_effect=fake):
            with self.assertRaises(TimeoutError):self.a.phase('start-qwen')
        self.assertEqual(self.a.pending_phase,'start-qwen')
        with self.assertRaises(RuntimeError):self.a.stop_qwen_and_prove_gpu_free()
