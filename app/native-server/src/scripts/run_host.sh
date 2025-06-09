#!/bin/bash
# 获取脚本所在的绝对目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# 日志目录改为脚本同级目录下的 logs 文件夹
LOG_DIR="${SCRIPT_DIR}/logs"

# 获取当前时间戳用于日志文件名
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
WRAPPER_LOG="${LOG_DIR}/native_host_wrapper_macos_${TIMESTAMP}.log"
STDERR_LOG="${LOG_DIR}/native_host_stderr_macos_${TIMESTAMP}.log"

# Node.js 脚本的实际路径
NODE_SCRIPT="${SCRIPT_DIR}/index.js"

# 确保日志目录存在 (如果构建脚本忘记创建，这里会尝试创建)
mkdir -p "${LOG_DIR}"

# 记录 wrapper 脚本被调用的信息
echo "Wrapper script called at $(date)" > "${WRAPPER_LOG}"
echo "SCRIPT_DIR: ${SCRIPT_DIR}" >> "${WRAPPER_LOG}"
echo "LOG_DIR: ${LOG_DIR}" >> "${WRAPPER_LOG}"
echo "NODE_SCRIPT: ${NODE_SCRIPT}" >> "${WRAPPER_LOG}"
echo "Initial PATH: ${PATH}" >> "${WRAPPER_LOG}"
echo "User: $(whoami)" >> "${WRAPPER_LOG}"
echo "Current PWD: $(pwd)" >> "${WRAPPER_LOG}"


NODE_EXEC=""
# 1. 尝试用 command -v node
if command -v node &>/dev/null; then
    NODE_EXEC=$(command -v node)
    echo "Found node using 'command -v node': ${NODE_EXEC}" >> "${WRAPPER_LOG}"
fi

# 2. 如果找不到，尝试一些 macOS 上常见的 Node.js 安装路径
if [ -z "${NODE_EXEC}" ]; then
    COMMON_NODE_PATHS=(
        "/usr/local/bin/node"
        "/opt/homebrew/bin/node"
        "$HOME/.nvm/nvm.sh" # Source NVM first if present
    )
    # Attempt to source NVM if nvm.sh exists
    NVM_DIR="$HOME/.nvm"
    if [ -s "$NVM_DIR/nvm.sh" ]; then
      echo "Attempting to source NVM from $NVM_DIR/nvm.sh" >> "${WRAPPER_LOG}"
      # It's tricky to reliably source nvm and get its environment in a non-interactive script
      # launched by Chrome. A simpler approach for NVM is to find the active version's binary directly.
      # This often requires a more specific NVM path based on the active version.
      # The following is a heuristic and might not always work for all NVM setups.
      # It tries to find the latest installed version if the NVM_SYMLINK_CURRENT is not set.
      NVM_NODE_PATH=""
      if [ -n "$(ls -A $NVM_DIR/versions/node 2>/dev/null)" ]; then
        LATEST_NVM_NODE_VERSION=$(ls -v $NVM_DIR/versions/node | tail -n 1)
        if [ -x "$NVM_DIR/versions/node/${LATEST_NVM_NODE_VERSION}/bin/node" ]; then
            NVM_NODE_PATH="$NVM_DIR/versions/node/${LATEST_NVM_NODE_VERSION}/bin/node"
            echo "Found potential NVM node (latest installed): ${NVM_NODE_PATH}" >> "${WRAPPER_LOG}"
            COMMON_NODE_PATHS+=("${NVM_NODE_PATH}") # Add to paths to check
        fi
      fi
    fi

    for path_to_node in "${COMMON_NODE_PATHS[@]}"; do
        # For nvm.sh, it's not a node executable directly
        if [[ "${path_to_node}" == *nvm.sh ]]; then
            continue
        fi
        if [ -x "${path_to_node}" ]; then
            NODE_EXEC="${path_to_node}"
            echo "Found node at common path: ${NODE_EXEC}" >> "${WRAPPER_LOG}"
            break
        fi
    done
fi

# 3. 最后的尝试：在 PATH 中查找
if [ -z "${NODE_EXEC}" ]; then
    IFS_OLD=$IFS
    IFS=:
    for path_in_env_path in $PATH; do
        if [ -x "${path_in_env_path}/node" ]; then
            NODE_EXEC="${path_in_env_path}/node"
            echo "Found node in environment PATH: ${NODE_EXEC}" >> "${WRAPPER_LOG}"
            break
        fi
    done
    IFS=$IFS_OLD
fi


if [ -z "${NODE_EXEC}" ]; then
    echo "ERROR: Node.js executable not found!" >> "${WRAPPER_LOG}"
    echo "Searched 'command -v', common paths, and PATH environment variable." >> "${WRAPPER_LOG}"
    exit 1
fi

echo "Using Node executable: ${NODE_EXEC}" >> "${WRAPPER_LOG}"
echo "Node version found by script: $(${NODE_EXEC} -v)" >> "${WRAPPER_LOG}"
echo "Executing: ${NODE_EXEC} ${NODE_SCRIPT}" >> "${WRAPPER_LOG}"

# exec会替换当前脚本进程，stderr会直接输出到Chrome（如果它能捕获的话）或丢失
# 为了确保stderr被记录到文件，我们不直接exec然后重定向整个脚本的stderr
# 而是让node脚本的stderr重定向
exec "${NODE_EXEC}" "${NODE_SCRIPT}" 2>> "${STDERR_LOG}"