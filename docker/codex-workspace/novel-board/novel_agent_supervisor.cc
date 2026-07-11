#include <dirent.h>
#include <errno.h>
#include <signal.h>
#include <sys/prctl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <fstream>
#include <string>
#include <unordered_set>
#include <vector>

namespace {

volatile sig_atomic_t termination_signal = 0;

void handle_termination(int signal_number) {
  if (termination_signal == 0) {
    termination_signal = signal_number;
  }
}

bool numeric_name(const char* value) {
  if (*value == '\0') {
    return false;
  }
  for (const char* cursor = value; *cursor != '\0'; ++cursor) {
    if (*cursor < '0' || *cursor > '9') {
      return false;
    }
  }
  return true;
}

std::vector<pid_t> direct_children(pid_t process_id) {
  std::vector<pid_t> children;
  const std::string task_path =
      "/proc/" + std::to_string(process_id) + "/task";
  DIR* tasks = opendir(task_path.c_str());
  if (tasks == nullptr) {
    return children;
  }

  while (dirent* task = readdir(tasks)) {
    if (!numeric_name(task->d_name)) {
      continue;
    }
    const std::string children_path =
        task_path + "/" + task->d_name + "/children";
    std::ifstream input(children_path);
    pid_t child = 0;
    while (input >> child) {
      children.push_back(child);
    }
  }
  closedir(tasks);
  return children;
}

std::vector<pid_t> descendants(pid_t root) {
  std::vector<pid_t> result;
  std::deque<pid_t> pending{root};
  std::unordered_set<pid_t> seen{root};

  while (!pending.empty()) {
    const pid_t parent = pending.front();
    pending.pop_front();
    for (const pid_t child : direct_children(parent)) {
      if (child > 1 && seen.insert(child).second) {
        result.push_back(child);
        pending.push_back(child);
      }
    }
  }
  return result;
}

void signal_processes(const std::vector<pid_t>& processes, int signal_number,
                      std::unordered_set<pid_t>* already_signaled) {
  for (auto process = processes.rbegin(); process != processes.rend(); ++process) {
    if (already_signaled != nullptr &&
        !already_signaled->insert(*process).second) {
      continue;
    }
    if (kill(*process, signal_number) == -1 && errno != ESRCH) {
      std::fprintf(stderr, "novel-agent-supervisor: kill(%d, %d): %s\n",
                   static_cast<int>(*process), signal_number,
                   std::strerror(errno));
    }
  }
}

int exit_code_for_status(int status) {
  if (WIFEXITED(status)) {
    return WEXITSTATUS(status);
  }
  if (WIFSIGNALED(status)) {
    return 128 + WTERMSIG(status);
  }
  return 125;
}

void install_handler(int signal_number) {
  struct sigaction action {};
  action.sa_handler = handle_termination;
  sigemptyset(&action.sa_mask);
  action.sa_flags = 0;
  if (sigaction(signal_number, &action, nullptr) == -1) {
    std::perror("novel-agent-supervisor: sigaction");
    std::exit(125);
  }
}

void reset_handler(int signal_number) {
  struct sigaction action {};
  action.sa_handler = SIG_DFL;
  sigemptyset(&action.sa_mask);
  action.sa_flags = 0;
  sigaction(signal_number, &action, nullptr);
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 5 || std::strcmp(argv[1], "--grace-ms") != 0 ||
      std::strcmp(argv[3], "--") != 0) {
    std::fprintf(stderr,
                 "usage: novel-agent-supervisor --grace-ms N -- command ...\n");
    return 64;
  }

  char* end = nullptr;
  const long grace_ms = std::strtol(argv[2], &end, 10);
  if (end == argv[2] || *end != '\0' || grace_ms < 1) {
    std::fprintf(stderr, "novel-agent-supervisor: invalid grace period: %s\n",
                 argv[2]);
    return 64;
  }

  if (prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) == -1) {
    std::perror("novel-agent-supervisor: PR_SET_CHILD_SUBREAPER");
    return 125;
  }
  install_handler(SIGTERM);
  install_handler(SIGINT);
  install_handler(SIGHUP);

  const pid_t main_child = fork();
  if (main_child == -1) {
    std::perror("novel-agent-supervisor: fork");
    return 125;
  }
  if (main_child == 0) {
    reset_handler(SIGTERM);
    reset_handler(SIGINT);
    reset_handler(SIGHUP);
    execvp(argv[4], &argv[4]);
    std::fprintf(stderr, "novel-agent-supervisor: exec %s: %s\n", argv[4],
                 std::strerror(errno));
    _exit(127);
  }

  enum class Phase { running, natural_grace, terminating, killing };
  Phase phase = Phase::running;
  bool main_exited = false;
  int main_status = 0;
  int empty_observations = 0;
  std::unordered_set<pid_t> term_signaled;
  auto deadline = std::chrono::steady_clock::time_point::max();
  const auto grace = std::chrono::milliseconds(grace_ms);

  while (true) {
    int status = 0;
    pid_t reaped = 0;
    while ((reaped = waitpid(-1, &status, WNOHANG)) > 0) {
      if (reaped == main_child) {
        main_exited = true;
        main_status = status;
      }
    }

    const auto now = std::chrono::steady_clock::now();
    if (termination_signal != 0 && phase != Phase::terminating &&
        phase != Phase::killing) {
      phase = Phase::terminating;
      deadline = now + grace;
    } else if (main_exited && phase == Phase::running) {
      phase = Phase::natural_grace;
      deadline = now + grace;
    }

    std::vector<pid_t> active = descendants(getpid());
    if (phase == Phase::natural_grace && now >= deadline && !active.empty()) {
      phase = Phase::terminating;
      deadline = now + grace;
    }
    if (phase == Phase::terminating) {
      signal_processes(active, SIGTERM, &term_signaled);
      if (now >= deadline) {
        phase = Phase::killing;
      }
    }
    if (phase == Phase::killing) {
      signal_processes(active, SIGKILL, nullptr);
    }

    if (main_exited && active.empty()) {
      ++empty_observations;
      if (empty_observations >= 2) {
        return termination_signal == 0 ? exit_code_for_status(main_status)
                                       : 128 + termination_signal;
      }
    } else {
      empty_observations = 0;
    }

    struct timespec pause {0, 20 * 1000 * 1000};
    nanosleep(&pause, nullptr);
  }
}
