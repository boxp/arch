import json
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

from importlib.util import module_from_spec, spec_from_file_location

ROOT = Path(__file__).resolve().parents[1]
spec = spec_from_file_location("aggregate_ansible_plan", ROOT / ".github/scripts/aggregate_ansible_plan.py")
aggregate_module = module_from_spec(spec)
spec.loader.exec_module(aggregate_module)


def plan(node="shanghai-1", playbook="control-plane", **overrides):
    value = {
        "node": node, "playbook": playbook, "has_changes": False,
        "stats": {}, "changed_tasks": [], "failed_tasks": [],
    }
    value.update(overrides)
    return value


class AggregationTests(unittest.TestCase):
    def aggregate(self, records, expected=("shanghai-1",), results=None):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            inputs = list(records)
            existing_status = {r.get("node") for r in inputs if "job_status" in r}
            inputs.extend({"node": node, "job_status": "success"} for node in expected if node not in existing_status)
            for index, record in enumerate(inputs):
                suffix = "-status.json" if "job_status" in record else ".fmt.json"
                (path / f"record-{index}{suffix}").write_text(json.dumps(record))
            return aggregate_module.aggregate(path, list(expected), results or {"plan": "success"})

    def test_repeated_processing_and_duplicate_artifacts_are_idempotent(self):
        result = self.aggregate([plan(), plan()], results={"plan": "success"})
        again = self.aggregate([plan(), plan(), plan()], results={"plan": "success"})
        self.assertEqual(len(result["plans"]), 1)
        self.assertEqual(result, again)
        self.assertFalse(result["has_changes"])

    def test_missing_node_never_reports_no_changes(self):
        result = self.aggregate([], expected=("shanghai-1", "golyat-4"))
        self.assertTrue(result["has_changes"])
        self.assertTrue(any(p["status"] == "missing" for p in result["plans"]))

    def test_task_failure_and_job_failure_never_report_no_changes(self):
        failed = plan(failed_tasks=[{"name": "broken"}])
        result = self.aggregate([failed], results={"plan": "failure"})
        self.assertTrue(result["has_changes"])
        self.assertEqual(result["plans"][0]["status"], "failed")
        stat_failure = self.aggregate([plan(stats={"host": {"failures": 1, "unreachable": 0}})])
        self.assertTrue(stat_failure["has_changes"])
        self.assertEqual(stat_failure["plans"][0]["status"], "failed")

    def test_skip_is_reported_as_attention_not_clean(self):
        result = self.aggregate([plan(playbook="cp-memory-headroom")])
        self.assertTrue(result["has_changes"])
        self.assertEqual(result["plans"][0]["status"], "skipped")

    def test_unreachable_skip_preserves_skip_reason(self):
        result = self.aggregate([plan(playbook="ssh-connectivity", stats={"shanghai-1": {"unreachable": 1}})])
        self.assertTrue(result["problems"])
        self.assertEqual(result["plans"][0]["status"], "skipped")

    def test_all_nodes_and_node_specific_results_are_complete_once(self):
        nodes = ["shanghai-1", "shanghai-2", "shanghai-3", "golyat-4"]
        records = []
        for node in nodes:
            primary = "worker-image" if node == "golyat-4" else "control-plane"
            expected = [primary, f"node-{node}"]
            records.extend(plan(node, playbook) for playbook in expected)
            records.append({"node": node, "job_status": "success", "expected_playbooks": expected})
        result = self.aggregate(records, nodes, {"control-plane": "success", "worker": "success"})
        self.assertEqual(result["problems"], [])
        self.assertFalse(result["has_changes"])
        self.assertEqual(len(result["plans"]), 8)
        self.assertTrue(all(p["status"] == "complete" for p in result["plans"]))

    def test_cancelled_group_never_reports_clean(self):
        result = self.aggregate([plan()], results={"control-plane": "cancelled", "worker": "success"})
        self.assertTrue(result["has_changes"])
        self.assertIn("cancelled", " ".join(result["problems"]))

    def test_partial_node_result_is_not_clean(self):
        result = self.aggregate(
            [plan(), {"node": "shanghai-1", "job_status": "failure"}],
            results={"plan": "failure"},
        )
        self.assertTrue(result["has_changes"])
        self.assertEqual(result["plans"][0]["status"], "partial")

    def test_missing_required_playbook_is_partial(self):
        result = self.aggregate([])
        self.assertTrue(result["has_changes"])
        self.assertTrue(any("No plan artifact" in problem for problem in result["problems"]))

    def test_missing_node_specific_playbook_from_manifest_is_partial(self):
        result = self.aggregate([
            plan(),
            {"node": "shanghai-1", "job_status": "success",
             "expected_playbooks": ["control-plane", "node-shanghai-1"]},
        ])
        self.assertTrue(result["has_changes"])
        self.assertTrue(any(p["playbook"] == "node-shanghai-1" and p["status"] == "missing" for p in result["plans"]))

    def test_raw_ansible_json_is_not_treated_as_formatted_result(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "raw.json").write_text(json.dumps(plan()))
            result = aggregate_module.aggregate(path, ["shanghai-1"], {"plan": "success"})
        self.assertTrue(result["has_changes"])
        self.assertEqual(result["plans"][0]["status"], "missing")

    def test_conflicting_duplicate_marks_incomplete(self):
        result = self.aggregate([plan(), plan(has_changes=True)])
        self.assertTrue(result["has_changes"])
        self.assertIn("Conflicting duplicate", " ".join(result["problems"]))


class WorkflowGraphTests(unittest.TestCase):
    @staticmethod
    def job_block(workflow, name):
        lines = workflow.splitlines()
        start = lines.index(f"  {name}:")
        end = next((i for i in range(start + 1, len(lines)) if re.match(r"^  [a-zA-Z0-9_-]+:$", lines[i])), len(lines))
        return "\n".join(lines[start:end])

    def test_control_plane_is_serial_worker_is_independent_and_comment_waits_for_both(self):
        workflow = (ROOT / ".github/workflows/plan-ansible.yml").read_text()
        cp = self.job_block(workflow, "control-plane")
        worker = self.job_block(workflow, "worker")
        comment = self.job_block(workflow, "comment")
        self.assertIn("node: [shanghai-1, shanghai-2, shanghai-3]", cp)
        self.assertIn("max-parallel: 1", cp)
        self.assertNotIn("needs:", cp)
        self.assertIn("node: golyat-4", worker)
        self.assertNotIn("needs:", worker)
        self.assertIn("needs: [control-plane, worker]", comment)
        self.assertIn("if: ${{ always() }}", comment)
        self.assertIn("pattern: plan-*", comment)

    def test_shared_node_workflow_keeps_safety_guards_and_always_artifact(self):
        workflow = (ROOT / ".github/workflows/plan-ansible-node.yml").read_text()
        for expected in (
            "CP_PLAN_MIN_MEMAVAILABLE_MIB: '600'", "CP_PLAN_HEADROOM_WAIT_SECONDS: '300'",
            "CP_PLAN_HEADROOM_POLL_SECONDS: '30'", "--check --diff", "continue-on-error: true",
            "Record node job status", "if: always()", "actions/upload-artifact@",
            "worker_static_network_interface=enp44s0", "expected_playbooks", "node-${NODE}",
        ):
            self.assertIn(expected, workflow)


class AnsibleExitTests(unittest.TestCase):
    def test_ansible_failures_fail_job_but_formatter_changes_do_not(self):
        workflow = (ROOT / ".github/workflows/plan-ansible-node.yml").read_text()
        function = workflow.split("          run_ansible() {", 1)[1].split('          if [[ "$NODE"', 1)[0]
        function = "run_ansible() {" + function
        for ansible_exit, formatter_exit, expected in [(0, 0, 0), (0, 2, 0), (2, 2, 2), (0, 1, 1), (0, 127, 1), (4, 0, 4)]:
            with self.subTest(ansible=ansible_exit, formatter=formatter_exit), tempfile.TemporaryDirectory() as directory:
                script = f'''set -e
mkdir plan_outputs
ansible-playbook() {{ echo '{{}}'; return {ansible_exit}; }}
ansible-plan-formatter() {{ cat; return {formatter_exit}; }}
{function}
run_ansible fake.yml shanghai-1 control-plane plan_outputs/result.fmt.json
'''
                result = subprocess.run(["bash", "-c", script], cwd=directory, capture_output=True, text=True)
                self.assertEqual(result.returncode, expected, result.stderr)
                if ansible_exit in (0, 2):
                    self.assertTrue((Path(directory) / "plan_outputs/result.fmt.json").exists())


if __name__ == "__main__":
    unittest.main()
